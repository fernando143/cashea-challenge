import { buildInstallmentPlan, assertInstallmentCount, type InstallmentCount, type InstallmentPlanItem } from "../domain/installments";
import { parseAmountCents } from "../domain/money";
import { createInstallments, findInstallmentsByPurchaseId, type InstallmentRecord } from "../repositories/installments.repository";
import { completeIdempotency, reserveIdempotency } from "../repositories/idempotency.repository";
import { findPaymentMethodByUserId } from "../repositories/payment-methods.repository";
import { createPurchase, findPurchaseOwned, type PurchaseDetailsRecord } from "../repositories/purchases.repository";
import { reserveCredit } from "../repositories/credit-lines.repository";
import type { Database } from "../repositories/types";
import { ApplicationError } from "./application-error";
import { settleInstallment } from "./installment-settlement";
import { withTransaction } from "./transaction";

export interface PurchaseInput {
  amount: unknown;
  installments: unknown;
}

export interface PurchasePreview {
  amount: bigint;
  installments: InstallmentCount;
  plan: InstallmentPlanItem[];
}

export interface PurchaseData {
  purchase: PurchaseDetailsRecord;
  installments: InstallmentRecord[];
  available: string;
}

export type PurchaseCreationResult =
  | { code: "PURCHASE_CREATED"; data: PurchaseData; replay: boolean }
  | { code: "PURCHASE_CREATED"; legacyBody: Record<string, unknown>; replay: true }
  | { code: "PAYMENT_METHOD_REQUIRED" | "INSUFFICIENT_CREDIT"; message: string; replay: boolean };

export interface PurchaseService {
  preview(input: PurchaseInput, purchaseDate?: Date): PurchasePreview;
  create(userId: string, input: PurchaseInput, idempotencyKey: string): Promise<PurchaseCreationResult>;
  get(userId: string, purchaseId: string): Promise<{ purchase: PurchaseDetailsRecord; installments: InstallmentRecord[] }>;
}

function normalizeInput(input: PurchaseInput): { amount: bigint; installments: InstallmentCount } {
  let amount: bigint;
  try {
    amount = parseAmountCents(input.amount);
  } catch (error) {
    throw new ApplicationError(
      "INVALID_AMOUNT",
      error instanceof Error ? error.message : "Invalid amount",
    );
  }

  try {
    assertInstallmentCount(input.installments);
  } catch (error) {
    throw new ApplicationError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Invalid installments",
    );
  }

  if (amount < BigInt(input.installments)) {
    throw new ApplicationError("INVALID_AMOUNT", "amount must be at least the number of installments");
  }
  return { amount, installments: input.installments };
}

function requestHash(input: { amount: bigint; installments: number }): string {
  return JSON.stringify({ amount: input.amount.toString(), installments: input.installments });
}

type StoredPurchaseResult =
  | { data: PurchaseData }
  | { message: string };

function replayPurchase(code: string, body: unknown): PurchaseCreationResult {
  if (!body || typeof body !== "object") {
    throw new Error("Stored purchase result is invalid");
  }
  if (code === "PURCHASE_CREATED" && "data" in body) {
    return { code, data: (body as { data: PurchaseData }).data, replay: true };
  }
  if (code === "PURCHASE_CREATED" && "legacyBody" in body) {
    return {
      code,
      legacyBody: (body as { legacyBody: Record<string, unknown> }).legacyBody,
      replay: true,
    };
  }
  if ((code === "PAYMENT_METHOD_REQUIRED" || code === "INSUFFICIENT_CREDIT") && "message" in body) {
    return { code, message: String((body as { message: unknown }).message), replay: true };
  }
  throw new Error(`Stored purchase result has unsupported code ${code}`);
}

export function createPurchaseService(database: Database): PurchaseService {
  return {
    preview(input, purchaseDate = new Date()) {
      const normalized = normalizeInput(input);
      return {
        ...normalized,
        plan: buildInstallmentPlan(normalized.amount, normalized.installments, purchaseDate),
      };
    },

    async create(userId, input, idempotencyKey) {
      const normalized = normalizeInput(input);
      const hash = requestHash(normalized);

      return withTransaction(database, async (client) => {
        const reservation = await reserveIdempotency(client, userId, "purchase", idempotencyKey, hash);
        if (reservation.kind === "replay") return replayPurchase(reservation.code, reservation.body);
        if (reservation.kind === "different_request") {
          throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different request");
        }
        if (reservation.kind === "in_progress") {
          throw new ApplicationError("IDEMPOTENCY_IN_PROGRESS", "An operation with this idempotency key is in progress");
        }

        const paymentMethod = await findPaymentMethodByUserId(client, userId);
        if (!paymentMethod) {
          const result = { message: "No payment method is available" } satisfies StoredPurchaseResult;
          await completeIdempotency(client, reservation.id, "PAYMENT_METHOD_REQUIRED", result);
          return { code: "PAYMENT_METHOD_REQUIRED", ...result, replay: false };
        }

        const creditLine = await reserveCredit(client, userId, normalized.amount);
        if (!creditLine) {
          const result = { message: "Insufficient available credit" } satisfies StoredPurchaseResult;
          await completeIdempotency(client, reservation.id, "INSUFFICIENT_CREDIT", result);
          return { code: "INSUFFICIENT_CREDIT", ...result, replay: false };
        }

        const purchase = await createPurchase(client, {
          userId,
          paymentMethodId: paymentMethod.id,
          amount: normalized.amount,
          installments: normalized.installments,
        });
        const plan = buildInstallmentPlan(normalized.amount, normalized.installments, purchase.created_at);
        await createInstallments(
          client,
          purchase.id,
          plan.map((item) => ({ ...item, paid: false, paidAt: null })),
        );

        const createdInstallments = await findInstallmentsByPurchaseId(client, purchase.id);
        const firstInstallment = createdInstallments[0];
        if (!firstInstallment) throw new Error("Purchase was created without installments");
        const settlement = await settleInstallment(client, userId, firstInstallment);
        const persistedPurchase = await findPurchaseOwned(client, userId, purchase.id);
        if (!persistedPurchase) {
          throw new ApplicationError("PURCHASE_LOAD_FAILED", "Purchase could not be loaded");
        }

        const data: PurchaseData = {
          purchase: persistedPurchase,
          installments: createdInstallments.map((item) => item.id === settlement.installment.id ? settlement.installment : item),
          available: settlement.credit.available,
        };
        const stored = { data } satisfies StoredPurchaseResult;
        await completeIdempotency(client, reservation.id, "PURCHASE_CREATED", stored);
        return { code: "PURCHASE_CREATED", data, replay: false };
      });
    },

    async get(userId, purchaseId) {
      const purchase = await findPurchaseOwned(database, userId, purchaseId);
      if (!purchase) throw new ApplicationError("NOT_FOUND", "Purchase not found");
      const installments = await findInstallmentsByPurchaseId(database, purchase.id);
      return { purchase, installments };
    },
  };
}

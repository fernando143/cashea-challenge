import { db } from "../config/db";
import { buildInstallmentPlan, assertInstallmentCount, type InstallmentCount } from "../domain/installments";
import { assertPositiveCents, toCents, type CentsInput } from "../domain/money";
import { AppError } from "../http/errors";
import { createInstallments, findInstallmentsByPurchaseId } from "../repositories/installments.repository";
import { completeIdempotency, reserveIdempotency } from "../repositories/idempotency.repository";
import { findPaymentMethodByUserId } from "../repositories/payment-methods.repository";
import { createPurchase, findPurchaseOwned } from "../repositories/purchases.repository";
import { reserveCredit, restoreCredit } from "../repositories/credit-lines.repository";
import { serializeCents, serializePurchase } from "./serialization";

export interface PurchaseInput {
  amount: CentsInput;
  installments: unknown;
}

function normalizeInput(input: PurchaseInput): { amount: bigint; installments: InstallmentCount } {
  try {
    const amount = toCents(input.amount);
    assertPositiveCents(amount);
    assertInstallmentCount(input.installments);
    if (amount < BigInt(input.installments)) {
      throw new RangeError("amount must be at least the number of installments");
    }
    return { amount, installments: input.installments };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, error instanceof Error ? error.message : "Invalid purchase input", "INVALID_INPUT");
  }
}

function requestHash(input: { amount: bigint; installments: number }): string {
  return JSON.stringify({ amount: input.amount.toString(), installments: input.installments });
}

export function previewPurchase(input: PurchaseInput, purchaseDate = new Date()): Record<string, unknown> {
  const normalized = normalizeInput(input);
  const plan = buildInstallmentPlan(normalized.amount, normalized.installments, purchaseDate);
  return {
    amount: serializeCents(normalized.amount),
    installments: normalized.installments,
    plan: plan.map((item) => ({
      number: item.number,
      amount: serializeCents(item.amount),
      dueDate: item.dueDate,
    })),
  };
}

export async function createPurchaseForUser(
  userId: string,
  input: PurchaseInput,
  idempotencyKey: string,
): Promise<{ status: number; body: Record<string, unknown>; replay: boolean }> {
  const normalized = normalizeInput(input);
  const hash = requestHash(normalized);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const reservation = await reserveIdempotency(client, userId, "purchase", idempotencyKey, hash);
    if (reservation.kind === "replay") {
      await client.query("COMMIT");
      return { status: reservation.status, body: reservation.body as Record<string, unknown>, replay: true };
    }
    if (reservation.kind === "in_progress") {
      throw new AppError(409, "An operation with this idempotency key is in progress", "IDEMPOTENCY_IN_PROGRESS");
    }

    const paymentMethod = await findPaymentMethodByUserId(client, userId);
    if (!paymentMethod) {
      const body = { error: "No payment method is available", code: "PAYMENT_METHOD_REQUIRED" };
      await completeIdempotency(client, reservation.id, 409, body);
      await client.query("COMMIT");
      return { status: 409, body, replay: false };
    }
    const creditLine = await reserveCredit(client, userId, normalized.amount);
    if (!creditLine) {
      const body = { error: "Insufficient available credit", code: "INSUFFICIENT_CREDIT" };
      await completeIdempotency(client, reservation.id, 409, body);
      await client.query("COMMIT");
      return { status: 409, body, replay: false };
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
      plan.map((item) => ({
        ...item,
        paid: item.number === 1,
        paidAt: item.number === 1 ? purchase.created_at : null,
      })),
    );
    const restoredCredit = await restoreCredit(client, userId, plan[0]!.amount);
    if (!restoredCredit) {
      throw new AppError(500, "Credit line could not be updated", "CREDIT_UPDATE_FAILED");
    }
    const persistedPurchase = await findPurchaseOwned(client, userId, purchase.id);
    const persistedInstallments = await findInstallmentsByPurchaseId(client, purchase.id);
    if (!persistedPurchase) throw new AppError(500, "Purchase could not be loaded", "PURCHASE_LOAD_FAILED");
    const body = {
      purchase: serializePurchase(persistedPurchase, persistedInstallments),
      available: serializeCents(restoredCredit.available),
    };
    await completeIdempotency(client, reservation.id, 201, body);
    await client.query("COMMIT");
    return { status: 201, body, replay: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.message.includes("Idempotency key")) {
      throw new AppError(409, error.message, "IDEMPOTENCY_KEY_REUSED");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getPurchaseForUser(
  userId: string,
  purchaseId: string,
): Promise<Record<string, unknown>> {
  const purchase = await findPurchaseOwned(db, userId, purchaseId);
  if (!purchase) throw new AppError(404, "Purchase not found", "NOT_FOUND");
  const installments = await findInstallmentsByPurchaseId(db, purchase.id);
  return serializePurchase(purchase, installments);
}

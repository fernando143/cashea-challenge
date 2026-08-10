import { findOwnedInstallment, type InstallmentRecord } from "../repositories/installments.repository";
import { completeIdempotency, reserveIdempotency } from "../repositories/idempotency.repository";
import type { Database } from "../repositories/types";
import { ApplicationError } from "./application-error";
import { settleInstallment } from "./installment-settlement";
import { withTransaction } from "./transaction";

export interface PaymentData {
  installment: InstallmentRecord;
  available: string;
}

export type PaymentResult =
  | { code: "PAYMENT_COMPLETED"; data: PaymentData; replay: boolean }
  | { code: "PAYMENT_COMPLETED"; legacyBody: Record<string, unknown>; replay: true }
  | { code: "NOT_FOUND" | "ALREADY_PAID"; message: string; replay: boolean };

export interface PaymentService {
  pay(userId: string, purchaseId: string, installmentId: string, idempotencyKey: string): Promise<PaymentResult>;
}

type StoredPaymentResult = { data: PaymentData } | { message: string };

function replayPayment(code: string, body: unknown): PaymentResult {
  if (!body || typeof body !== "object") throw new Error("Stored payment result is invalid");
  if (code === "PAYMENT_COMPLETED" && "data" in body) {
    return { code, data: (body as { data: PaymentData }).data, replay: true };
  }
  if (code === "PAYMENT_COMPLETED" && "legacyBody" in body) {
    return {
      code,
      legacyBody: (body as { legacyBody: Record<string, unknown> }).legacyBody,
      replay: true,
    };
  }
  if ((code === "NOT_FOUND" || code === "ALREADY_PAID") && "message" in body) {
    return { code, message: String((body as { message: unknown }).message), replay: true };
  }
  throw new Error(`Stored payment result has unsupported code ${code}`);
}

export function createPaymentService(database: Database): PaymentService {
  return {
    async pay(userId, purchaseId, installmentId, idempotencyKey) {
      return withTransaction(database, async (client) => {
        const requestHash = JSON.stringify({ purchaseId, installmentId });
        const reservation = await reserveIdempotency(client, userId, "payment", idempotencyKey, requestHash);
        if (reservation.kind === "replay") return replayPayment(reservation.code, reservation.body);
        if (reservation.kind === "different_request") {
          throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different request");
        }
        if (reservation.kind === "in_progress") {
          throw new ApplicationError("IDEMPOTENCY_IN_PROGRESS", "An operation with this idempotency key is in progress");
        }

        const installment = await findOwnedInstallment(client, userId, purchaseId, installmentId);
        if (!installment) {
          const result = { message: "Installment not found" } satisfies StoredPaymentResult;
          await completeIdempotency(client, reservation.id, "NOT_FOUND", result);
          return { code: "NOT_FOUND", ...result, replay: false };
        }
        if (installment.status === "paid") {
          const result = { message: "Installment is already paid" } satisfies StoredPaymentResult;
          await completeIdempotency(client, reservation.id, "ALREADY_PAID", result);
          return { code: "ALREADY_PAID", ...result, replay: false };
        }

        const settlement = await settleInstallment(client, userId, installment);
        const data: PaymentData = {
          installment: settlement.installment,
          available: settlement.credit.available,
        };
        const stored = { data } satisfies StoredPaymentResult;
        await completeIdempotency(client, reservation.id, "PAYMENT_COMPLETED", stored);
        return { code: "PAYMENT_COMPLETED", data, replay: false };
      });
    },
  };
}

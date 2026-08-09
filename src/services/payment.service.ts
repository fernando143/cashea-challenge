import { db } from "../config/db";
import { AppError } from "../http/errors";
import { findCreditLineByUserId, restoreCredit } from "../repositories/credit-lines.repository";
import { findOwnedInstallment, markInstallmentPaid } from "../repositories/installments.repository";
import { completeIdempotency, reserveIdempotency } from "../repositories/idempotency.repository";
import { serializeCents, serializeInstallment } from "./serialization";

export async function payInstallmentForUser(
  userId: string,
  purchaseId: string,
  installmentId: string,
  idempotencyKey: string,
): Promise<{ status: number; body: Record<string, unknown>; replay: boolean }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const requestHash = JSON.stringify({ purchaseId, installmentId });
    const reservation = await reserveIdempotency(client, userId, "payment", idempotencyKey, requestHash);
    if (reservation.kind === "replay") {
      await client.query("COMMIT");
      return { status: reservation.status, body: reservation.body as Record<string, unknown>, replay: true };
    }
    if (reservation.kind === "in_progress") {
      throw new AppError(409, "An operation with this idempotency key is in progress", "IDEMPOTENCY_IN_PROGRESS");
    }

    const installment = await findOwnedInstallment(client, userId, purchaseId, installmentId);
    if (!installment) {
      const body = { error: "Installment not found", code: "NOT_FOUND" };
      await completeIdempotency(client, reservation.id, 404, body);
      await client.query("COMMIT");
      return { status: 404, body, replay: false };
    }
    if (installment.status === "paid") {
      const body = { error: "Installment is already paid", code: "ALREADY_PAID" };
      await completeIdempotency(client, reservation.id, 409, body);
      await client.query("COMMIT");
      return { status: 409, body, replay: false };
    }
    const paid = await markInstallmentPaid(client, installment.id);
    if (!paid) throw new AppError(409, "Installment is already paid", "ALREADY_PAID");
    const credit = await restoreCredit(client, userId, BigInt(installment.amount));
    if (!credit) throw new AppError(500, "Credit line could not be updated", "CREDIT_UPDATE_FAILED");
    const body = {
      installment: serializeInstallment(paid),
      available: serializeCents(credit.available),
    };
    await completeIdempotency(client, reservation.id, 200, body);
    await client.query("COMMIT");
    return { status: 200, body, replay: false };
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

export async function getAvailableCredit(userId: string): Promise<Record<string, unknown>> {
  const credit = await findCreditLineByUserId(db, userId);
  if (!credit) throw new AppError(404, "Credit line not found", "NOT_FOUND");
  return {
    creditLimit: serializeCents(credit.credit_limit),
    available: serializeCents(credit.available),
  };
}

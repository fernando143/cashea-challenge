import type { Request, Response } from "express";
import { AppError } from "../http/errors";
import { payInstallmentForUser } from "../services/payment.service";
import { sendControllerError } from "./api-error";

function userId(req: Request): string {
  if (!req.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  return req.userId;
}

function requiredParam(value: string | undefined, message: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(404, message, "NOT_FOUND");
  }
  return value;
}

export async function payInstallmentController(req: Request, res: Response): Promise<void> {
  try {
    const key = req.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) {
      throw new AppError(400, "Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
    }
    const purchaseId = requiredParam(req.params.purchaseId, "Installment not found");
    const installmentId = requiredParam(req.params.installmentId, "Installment not found");
    const result = await payInstallmentForUser(userId(req), purchaseId, installmentId, key);
    res.status(result.status).json(result.body);
  } catch (error) {
    sendControllerError(res, error);
  }
}

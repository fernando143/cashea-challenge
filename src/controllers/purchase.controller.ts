import type { Request, Response } from "express";
import { AppError } from "../http/errors";
import {
  createPurchaseForUser,
  getPurchaseForUser,
  previewPurchase,
  type PurchaseInput,
} from "../services/purchase.service";
import { sendControllerError } from "./api-error";

function userId(req: Request): string {
  if (!req.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  return req.userId;
}

function resourceId(value: string | undefined, message: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(404, message, "NOT_FOUND");
  }
  return value;
}

function idempotencyKey(req: Request): string {
  const value = req.header("Idempotency-Key")?.trim();
  if (!value || value.length > 255) throw new AppError(400, "Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
  return value;
}

function input(req: Request): PurchaseInput {
  const body = (req.body ?? {}) as { amount?: unknown; installments?: unknown };
  if (body.amount === undefined || body.installments === undefined) {
    throw new AppError(400, "amount and installments are required", "INVALID_INPUT");
  }
  return { amount: body.amount as PurchaseInput["amount"], installments: body.installments };
}

export async function previewPurchaseController(req: Request, res: Response): Promise<void> {
  try {
    res.json(previewPurchase(input(req)));
  } catch (error) {
    sendControllerError(res, error);
  }
}

export async function createPurchaseController(req: Request, res: Response): Promise<void> {
  try {
    const result = await createPurchaseForUser(userId(req), input(req), idempotencyKey(req));
    res.status(result.status).json(result.body);
  } catch (error) {
    sendControllerError(res, error);
  }
}

export async function getPurchaseController(req: Request, res: Response): Promise<void> {
  try {
    const purchaseId = resourceId(req.params.purchaseId, "Purchase not found");
    res.json(await getPurchaseForUser(userId(req), purchaseId));
  } catch (error) {
    sendControllerError(res, error);
  }
}

import type { RequestHandler } from "express";
import { AppError } from "../http/errors";
import { presentPurchase, presentPurchaseData, presentPurchasePreview } from "../http/presenters";
import { statusForCode } from "../http/status";
import { authenticatedUserId, idempotencyKey, resourceId } from "../http/request";
import type { PurchaseInput, PurchaseService } from "../services/purchase.service";

function input(body: unknown): PurchaseInput {
  const value = (body ?? {}) as { amount?: unknown; installments?: unknown };
  if (value.amount === undefined || value.installments === undefined) {
    throw new AppError(400, "amount and installments are required", "INVALID_INPUT");
  }
  return { amount: value.amount, installments: value.installments };
}

export interface PurchaseControllers {
  preview: RequestHandler;
  create: RequestHandler;
  get: RequestHandler;
}

export function createPurchaseControllers(service: PurchaseService): PurchaseControllers {
  return {
    preview(request, response) {
      response.json(presentPurchasePreview(service.preview(input(request.body))));
    },

    async create(request, response) {
      const result = await service.create(
        authenticatedUserId(request),
        input(request.body),
        idempotencyKey(request),
      );
      if (result.replay) response.setHeader("Idempotency-Replayed", "true");
      if (result.code === "PURCHASE_CREATED") {
        response.status(201).json("legacyBody" in result ? result.legacyBody : presentPurchaseData(result.data));
        return;
      }
      response.status(statusForCode(result.code)).json({ error: result.message, code: result.code });
    },

    async get(request, response) {
      const result = await service.get(
        authenticatedUserId(request),
        resourceId(request.params.purchaseId, "Purchase not found"),
      );
      response.json(presentPurchase(result.purchase, result.installments));
    },
  };
}

import type { RequestHandler } from "express";
import { presentPaymentData } from "../http/presenters";
import { authenticatedUserId, idempotencyKey, resourceId } from "../http/request";
import { statusForCode } from "../http/status";
import type { PaymentService } from "../services/payment.service";

export function createPaymentController(service: PaymentService): RequestHandler {
  return async (request, response) => {
    const key = idempotencyKey(request);
    const result = await service.pay(
      authenticatedUserId(request),
      resourceId(request.params.purchaseId, "Installment not found"),
      resourceId(request.params.installmentId, "Installment not found"),
      key,
    );
    if (result.replay) response.setHeader("Idempotency-Replayed", "true");
    if (result.code === "PAYMENT_COMPLETED") {
      response.json("legacyBody" in result ? result.legacyBody : presentPaymentData(result.data));
      return;
    }
    response.status(statusForCode(result.code)).json({ error: result.message, code: result.code });
  };
}

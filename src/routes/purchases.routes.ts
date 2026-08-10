import { Router } from "express";
import { createPaymentController } from "../controllers/payment.controller";
import { createPurchaseControllers } from "../controllers/purchase.controller";
import { asyncHandler } from "../http/async-handler";
import { authenticate } from "../insecure/auth";
import type { PaymentService } from "../services/payment.service";
import type { PurchaseService } from "../services/purchase.service";

export function createPurchasesRouter(
  purchaseService: PurchaseService,
  paymentService: PaymentService,
): Router {
  const router = Router();
  const purchases = createPurchaseControllers(purchaseService);
  const payInstallment = createPaymentController(paymentService);

  router.post("/purchases/preview", authenticate, asyncHandler(purchases.preview));
  router.post("/purchases", authenticate, asyncHandler(purchases.create));
  router.get("/purchases/:purchaseId", authenticate, asyncHandler(purchases.get));
  router.post(
    "/purchases/:purchaseId/installments/:installmentId/pay",
    authenticate,
    asyncHandler(payInstallment),
  );
  return router;
}

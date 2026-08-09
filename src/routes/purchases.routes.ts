import { Router } from "express";
import { authenticate } from "../insecure/auth";
import {
  createPurchaseController,
  getPurchaseController,
  previewPurchaseController,
} from "../controllers/purchase.controller";
import { payInstallmentController } from "../controllers/payment.controller";

export const purchasesRouter = Router();
purchasesRouter.post("/purchases/preview", authenticate, previewPurchaseController);
purchasesRouter.post("/purchases", authenticate, createPurchaseController);
purchasesRouter.get("/purchases/:purchaseId", authenticate, getPurchaseController);
purchasesRouter.post(
  "/purchases/:purchaseId/installments/:installmentId/pay",
  authenticate,
  payInstallmentController,
);

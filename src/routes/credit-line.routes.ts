import { Router } from "express";
import { createCreditLineController } from "../controllers/credit-line.controller";
import { asyncHandler } from "../http/async-handler";
import { authenticate } from "../insecure/auth";
import type { CreditLineService } from "../services/credit-line.service";

export function createCreditLineRouter(service: CreditLineService): Router {
  const router = Router();
  router.get("/credit-line", authenticate, asyncHandler(createCreditLineController(service)));
  return router;
}

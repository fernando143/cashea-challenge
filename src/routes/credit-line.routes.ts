import { Router } from "express";
import { authenticate } from "../insecure/auth";
import { getCreditLineController } from "../controllers/credit-line.controller";

export const creditLineRouter = Router();
creditLineRouter.get("/credit-line", authenticate, getCreditLineController);

import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { getCreditLineController } from "../controllers/credit-line.controller";

export const creditLineRouter = Router();
creditLineRouter.get("/credit-line", authenticate, getCreditLineController);

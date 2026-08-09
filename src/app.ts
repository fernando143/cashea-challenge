import express, { type Express } from "express";
import { healthRouter } from "./routes/health.routes";
import authRouter from "./insecure/auth";
import { creditLineRouter } from "./routes/credit-line.routes";
import { purchasesRouter } from "./routes/purchases.routes";

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use(healthRouter);
  app.use(authRouter);
  app.use(creditLineRouter);
  app.use(purchasesRouter);

  return app;
}

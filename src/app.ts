import express, { type Express } from "express";
import path from "node:path";
import { db } from "./config/db";
import { apiErrorHandler, notFoundHandler } from "./controllers/api-error";
import { healthRouter } from "./routes/health.routes";
import authRouter from "./insecure/auth";
import { createCreditLineRouter } from "./routes/credit-line.routes";
import { createPurchasesRouter } from "./routes/purchases.routes";
import type { Database } from "./repositories/types";
import { createCreditLineService } from "./services/credit-line.service";
import { createPaymentService } from "./services/payment.service";
import { createPurchaseService } from "./services/purchase.service";

export interface AppDependencies {
  database: Database;
}

export function createApp({ database = db }: Partial<AppDependencies> = {}): Express {
  const app = express();
  const purchaseService = createPurchaseService(database);
  const paymentService = createPaymentService(database);
  const creditLineService = createCreditLineService(database);

  app.use(express.json());

  app.use(express.static(path.join(__dirname, "../frontend")));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(createCreditLineRouter(creditLineService));
  app.use(createPurchasesRouter(purchaseService, paymentService));

  app.use(notFoundHandler);
  app.use(apiErrorHandler);

  return app;
}

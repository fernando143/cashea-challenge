import express, { type Express } from "express";
import { healthRouter } from "./routes/health.routes";
import authRouter from "./insecure/auth";

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use(healthRouter);
  app.use(authRouter);

  return app;
}

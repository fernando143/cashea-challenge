import type { Response } from "express";
import { errorMessage, errorStatus } from "../http/errors";

export function sendControllerError(response: Response, error: unknown): void {
  if (errorStatus(error) >= 500) console.error("Unhandled API error", error);
  response.status(errorStatus(error)).json({ error: errorMessage(error) });
}

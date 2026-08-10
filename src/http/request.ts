import type { Request } from "express";
import { AppError } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authenticatedUserId(request: Request): string {
  if (!request.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  return request.userId;
}

export function resourceId(value: string | undefined, message: string): string {
  if (!value || !UUID.test(value)) throw new AppError(404, message, "NOT_FOUND");
  return value;
}

export function idempotencyKey(request: Request): string {
  const value = request.header("Idempotency-Key")?.trim();
  if (!value || value.length > 255) {
    throw new AppError(400, "Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

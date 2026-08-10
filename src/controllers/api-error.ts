import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../http/errors";
import { statusForCode } from "../http/status";
import { ApplicationError } from "../services/application-error";

function malformedJson(error: unknown): boolean {
  return error instanceof SyntaxError
    && "status" in error
    && (error as SyntaxError & { status?: unknown }).status === 400;
}

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, "Route not found", "NOT_FOUND"));
};

export const apiErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next;
  if (malformedJson(error)) {
    response.status(400).json({ error: "Malformed JSON body", code: "INVALID_JSON" });
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) console.error("Unhandled API error", error);
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  if (error instanceof ApplicationError) {
    const status = statusForCode(error.code);
    if (status >= 500) console.error("Unhandled API error", error);
    response.status(status).json({ error: error.message, code: error.code });
    return;
  }

  console.error("Unhandled API error", error);
  response.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
};

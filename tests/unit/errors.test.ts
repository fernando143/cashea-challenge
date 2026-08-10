import { describe, expect, it } from "vitest";
import { AppError, errorMessage, errorStatus } from "../../src/http/errors";

describe("HTTP error helpers", () => {
  it("uses generic status and message for unknown errors", () => {
    const error = new Error("database details must not leak");
    expect(errorStatus(error)).toBe(500);
    expect(errorMessage(error)).toBe("Internal server error");
  });

  it("preserves application error status and message", () => {
    const error = new AppError(409, "Conflict", "CONFLICT");
    expect(errorStatus(error)).toBe(409);
    expect(errorMessage(error)).toBe("Conflict");
  });
});

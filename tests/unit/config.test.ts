import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/config/db";

describe("database client", () => {
  it("logs idle connection errors without exposing them to callers", () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      db.emit("error", new Error("idle connection failed"));
      expect(logSpy).toHaveBeenCalledWith(
        "Unexpected error on idle Postgres client",
        expect.any(Error),
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});

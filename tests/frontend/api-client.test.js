import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../../frontend/api-client.mjs";

describe("frontend API client", () => {
  it("preserves status, code and Retry-After from API failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ error: "Wait before trying again", code: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      }),
    );

    await expect(createApiClient({ fetchImpl }).getCreditLine("token-1")).rejects.toMatchObject({
      name: "ApiError",
      message: "Wait before trying again",
      status: 429,
      code: "RATE_LIMITED",
      retryAfter: "30",
    });
  });

  it("does not invent an error code when the API omits it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createApiClient({ fetchImpl }).login({ email: "a@b.c", password: "wrong" })).rejects.toMatchObject({
      message: "Invalid credentials",
      code: null,
      status: 401,
    });
  });

  it("rejects invalid JSON error bodies instead of using defaults", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response("{", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createApiClient({ fetchImpl }).getCreditLine("token-1")).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects error bodies that violate the API contract instead of using defaults", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ code: "INTERNAL_ERROR" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createApiClient({ fetchImpl }).getCreditLine("token-1")).rejects.toThrow(
      new TypeError("Invalid API error response"),
    );
  });

  it("distinguishes an uncertain network outcome from an HTTP response", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("connection reset"));

    await expect(
      createApiClient({ fetchImpl }).createPurchase({ amount: 300, installments: 3 }, "intent-1", "token-1"),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        status: 0,
        code: "NETWORK_ERROR",
      }),
    );
  });

  it("sends integer cents and the supplied idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ purchase: { id: "purchase-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await createApiClient({ fetchImpl }).createPurchase({ amount: 12_345, installments: 3 }, "intent-1", "token-1");

    const [path, options] = fetchImpl.mock.calls[0];
    expect(path).toBe("/purchases");
    expect(JSON.parse(options.body)).toEqual({ amount: 12_345, installments: 3 });
    expect(options.headers.get("Idempotency-Key")).toBe("intent-1");
    expect(options.headers.get("Authorization")).toBe("Bearer token-1");
  });

  it("exports ApiError for typed client-side validation errors", () => {
    expect(new ApiError("invalid", { status: 400, code: "INVALID_AMOUNT" })).toMatchObject({
      status: 400,
      code: "INVALID_AMOUNT",
    });
  });
});

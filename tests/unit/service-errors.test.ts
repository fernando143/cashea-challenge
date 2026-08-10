import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/config/db";
import { payInstallmentForUser } from "../../src/services/payment.service";
import { createPurchaseForUser } from "../../src/services/purchase.service";

function failingClient(): PoolClient {
  const query = vi.fn(async (statement: string) => {
    if (statement === "BEGIN") throw new Error("database unavailable");
    return { rows: [] };
  });
  return { query, release: vi.fn() } as unknown as PoolClient;
}

describe("service transaction failures", () => {
  it("rolls back and releases the client when payment fails unexpectedly", async () => {
    const client = failingClient();
    const connectSpy = vi.spyOn(db, "connect").mockResolvedValue(client);

    try {
      await expect(
        payInstallmentForUser(
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
          "payment-error",
        ),
      ).rejects.toThrow("database unavailable");
      expect(client.release).toHaveBeenCalledOnce();
    } finally {
      connectSpy.mockRestore();
    }
  });

  it("rolls back and releases the client when purchase creation fails unexpectedly", async () => {
    const client = failingClient();
    const connectSpy = vi.spyOn(db, "connect").mockResolvedValue(client);

    try {
      await expect(
        createPurchaseForUser(
          "00000000-0000-4000-8000-000000000001",
          { amount: 10000, installments: 3 },
          "purchase-error",
        ),
      ).rejects.toThrow("database unavailable");
      expect(client.release).toHaveBeenCalledOnce();
    } finally {
      connectSpy.mockRestore();
    }
  });
});

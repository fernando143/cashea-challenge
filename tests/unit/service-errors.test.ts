import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/repositories/types";
import { createPaymentService } from "../../src/services/payment.service";
import { createPurchaseService } from "../../src/services/purchase.service";

function failingDatabase(): { database: Database; client: PoolClient } {
  const query = vi.fn(async (statement: string) => {
    if (statement === "BEGIN") throw new Error("database unavailable");
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const database = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  } as unknown as Database;
  return { database, client };
}

describe("service transaction failures", () => {
  it("rolls back and releases the client when payment fails unexpectedly", async () => {
    const { database, client } = failingDatabase();
    await expect(
      createPaymentService(database).pay(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
        "payment-error",
      ),
    ).rejects.toThrow("database unavailable");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the client when purchase creation fails unexpectedly", async () => {
    const { database, client } = failingDatabase();
    await expect(
      createPurchaseService(database).create(
        "00000000-0000-4000-8000-000000000001",
        { amount: 10000, installments: 3 },
        "purchase-error",
      ),
    ).rejects.toThrow("database unavailable");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

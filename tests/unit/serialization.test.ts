import { describe, expect, it } from "vitest";
import { serializeCents, serializeInstallment, serializePurchase } from "../../src/services/serialization";

const purchase = {
  id: "purchase-1",
  user_id: "user-1",
  payment_method_id: "method-1",
  amount: "10001",
  installments: 3,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  brand: "visa",
  last4: "4242",
};

describe("serialization", () => {
  it("keeps amounts above JavaScript safe integer precision as strings", () => {
    expect(serializeCents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe("9007199254740992");
  });

  it("serializes date and paid installment fields", () => {
    const installment = {
      id: "installment-1",
      purchase_id: "purchase-1",
      number: 1,
      amount: "3334",
      due_date: new Date("2026-01-01T00:00:00.000Z"),
      status: "paid" as const,
      paid_at: new Date("2026-01-01T12:00:00.000Z"),
    };

    expect(serializeInstallment(installment)).toMatchObject({
      amount: 3334,
      dueDate: "2026-01-01",
      paidAt: "2026-01-01T12:00:00.000Z",
    });
    expect(serializeInstallment({ ...installment, due_date: "2026-01-02" })).toMatchObject({
      dueDate: "2026-01-02",
    });
    expect(serializePurchase(purchase, [installment])).toMatchObject({ status: "paid" });
  });
});

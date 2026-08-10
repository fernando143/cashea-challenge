import { describe, expect, it } from "vitest";
import {
  presentCents,
  presentInstallment,
  presentPurchase,
  presentPurchasePreview,
} from "../../src/http/presenters";

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

describe("HTTP presenters", () => {
  it("always emits exact JSON numbers", () => {
    expect(presentCents(99_999_999n)).toBe(99_999_999);
    expect(() => presentCents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow("cannot be represented");
  });

  it("serializes dates and exposes one canonical purchase plan", () => {
    const installment = {
      id: "installment-1",
      purchase_id: "purchase-1",
      number: 1,
      amount: "3334",
      due_date: new Date("2026-01-01T00:00:00.000Z"),
      status: "paid" as const,
      paid_at: "2026-01-01T12:00:00.000Z",
    };

    expect(presentInstallment(installment)).toMatchObject({
      amount: 3334,
      dueDate: "2026-01-01",
      paidAt: "2026-01-01T12:00:00.000Z",
    });
    const result = presentPurchase(purchase, [installment]);
    expect(result).toMatchObject({ status: "paid", plan: [expect.objectContaining({ amount: 3334 })] });
    expect(result).not.toHaveProperty("installmentsPlan");
  });

  it("presents preview data without formatting domain cents", () => {
    expect(presentPurchasePreview({
      amount: 10_001n,
      installments: 3,
      plan: [{ number: 1, amount: 3334n, dueDate: "2026-01-01" }],
    })).toMatchObject({ amount: 10_001, plan: [{ amount: 3334 }] });
  });
});

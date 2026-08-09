import type { InstallmentRecord } from "../repositories/installments.repository";
import type { PurchaseRecord } from "../repositories/purchases.repository";

export function serializeCents(value: bigint | string): number | string {
  const bigintValue = typeof value === "bigint" ? value : BigInt(value);
  return bigintValue <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(bigintValue)
    : bigintValue.toString();
}

export function serializeInstallment(item: InstallmentRecord): Record<string, unknown> {
  return {
    id: item.id,
    number: item.number,
    amount: serializeCents(item.amount),
    dueDate: item.due_date instanceof Date
      ? item.due_date.toISOString().slice(0, 10)
      : item.due_date,
    status: item.status,
    paidAt: item.paid_at?.toISOString() ?? null,
  };
}

export function serializePurchase(
  purchase: PurchaseRecord,
  installments: readonly InstallmentRecord[],
): Record<string, unknown> {
  const installmentsPlan = installments.map(serializeInstallment);
  return {
    id: purchase.id,
    amount: serializeCents(purchase.amount),
    installments: purchase.installments,
    status: installments.every((item) => item.status === "paid") ? "paid" : "pending",
    createdAt: purchase.created_at.toISOString(),
    paymentMethod: { brand: purchase.brand, last4: purchase.last4 },
    installmentsPlan,
    plan: installmentsPlan,
  };
}

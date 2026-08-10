import type { InstallmentRecord } from "../repositories/installments.repository";
import type { PurchaseDetailsRecord } from "../repositories/purchases.repository";
import type { PurchaseData, PurchasePreview } from "../services/purchase.service";
import type { PaymentData } from "../services/payment.service";

export function presentCents(value: bigint | string): number {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Stored cent value cannot be represented by the public API");
  }
  return Number(amount);
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function presentInstallment(item: InstallmentRecord): Record<string, unknown> {
  return {
    id: item.id,
    number: item.number,
    amount: presentCents(item.amount),
    dueDate: item.due_date instanceof Date
      ? item.due_date.toISOString().slice(0, 10)
      : item.due_date.slice(0, 10),
    status: item.status,
    paidAt: item.paid_at === null ? null : isoDate(item.paid_at),
  };
}

export function presentPurchase(
  purchase: PurchaseDetailsRecord,
  installments: readonly InstallmentRecord[],
): Record<string, unknown> {
  return {
    id: purchase.id,
    amount: presentCents(purchase.amount),
    installments: purchase.installments,
    status: installments.every((item) => item.status === "paid") ? "paid" : "pending",
    createdAt: isoDate(purchase.created_at),
    paymentMethod: { brand: purchase.brand, last4: purchase.last4 },
    plan: installments.map(presentInstallment),
  };
}

export function presentPurchasePreview(preview: PurchasePreview): Record<string, unknown> {
  return {
    amount: presentCents(preview.amount),
    installments: preview.installments,
    plan: preview.plan.map((item) => ({
      number: item.number,
      amount: presentCents(item.amount),
      dueDate: item.dueDate,
    })),
  };
}

export function presentPurchaseData(data: PurchaseData): Record<string, unknown> {
  return {
    purchase: presentPurchase(data.purchase, data.installments),
    available: presentCents(data.available),
  };
}

export function presentPaymentData(data: PaymentData): Record<string, unknown> {
  return {
    installment: presentInstallment(data.installment),
    available: presentCents(data.available),
  };
}

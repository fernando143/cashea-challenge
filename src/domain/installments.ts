import { assertPositiveCents, sumCents, toCents, type CentsInput } from "./money";

export const SUPPORTED_INSTALLMENTS = [3, 6, 12] as const;
export type InstallmentCount = (typeof SUPPORTED_INSTALLMENTS)[number];

export interface InstallmentPlanItem {
  number: number;
  amount: bigint;
  dueDate: string;
}

export function isInstallmentCount(value: unknown): value is InstallmentCount {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (SUPPORTED_INSTALLMENTS as readonly number[]).includes(value)
  );
}

export function assertInstallmentCount(value: unknown): asserts value is InstallmentCount {
  if (!isInstallmentCount(value)) {
    throw new RangeError("installments must be one of 3, 6, or 12");
  }
}

/**
 * Split an amount into positive cent values. Extra cents are assigned to the
 * earliest installments so the returned values always sum exactly to amount.
 */
export function splitInstallments(
  amountInput: CentsInput,
  installmentsInput: unknown,
): bigint[] {
  const amount = toCents(amountInput);
  assertInstallmentCount(installmentsInput);
  assertPositiveCents(amount);

  const installments = BigInt(installmentsInput);
  if (amount < installments) {
    throw new RangeError("amount must be at least the number of installments");
  }

  const base = amount / installments;
  const remainder = amount % installments;
  return Array.from({ length: installmentsInput }, (_, index) => {
    const receivesExtraCent = BigInt(index) < remainder;
    return base + (receivesExtraCent ? 1n : 0n);
  });
}

function asUtcDate(value: Date | string): Date {
  let date: Date;
  if (value instanceof Date) {
    date = new Date(value);
  } else {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00.000Z`
      : value;
    date = new Date(normalized);
  }
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("purchaseDate must be a valid date");
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Due dates are anchored to purchase date in 30-day monthly increments. */
export function dueDateForInstallment(
  purchaseDate: Date | string,
  installmentNumber: number,
): string {
  if (!Number.isInteger(installmentNumber) || installmentNumber < 1) {
    throw new RangeError("installment number must be a positive integer");
  }

  const date = asUtcDate(purchaseDate);
  date.setUTCDate(date.getUTCDate() + (installmentNumber - 1) * 30);
  return isoDate(date);
}

export function buildInstallmentPlan(
  amountInput: CentsInput,
  installmentsInput: unknown,
  purchaseDate: Date | string,
): InstallmentPlanItem[] {
  const amounts = splitInstallments(amountInput, installmentsInput);
  return amounts.map((amount, index) => ({
    number: index + 1,
    amount,
    dueDate: dueDateForInstallment(purchaseDate, index + 1),
  }));
}

export function assertPlanInvariant(
  amountInput: CentsInput,
  plan: readonly InstallmentPlanItem[],
  installmentsInput: unknown,
): void {
  const amount = toCents(amountInput);
  assertInstallmentCount(installmentsInput);
  if (plan.length !== installmentsInput) {
    throw new Error("installment plan has an unexpected number of entries");
  }
  if (sumCents(plan.map((item) => item.amount)) !== amount) {
    throw new Error("installment plan does not sum to the purchase amount");
  }
  if (plan.some((item, index) => item.number !== index + 1 || item.amount <= 0n)) {
    throw new Error("installment plan contains an invalid installment");
  }
}

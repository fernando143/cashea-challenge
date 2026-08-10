export type CentsInput = bigint | number | string;

export const MAX_AMOUNT_CENTS = 99_999_999n;

/**
 * Convert an external integer-cent value to the domain representation.
 * Numbers must be safe integers; strings may contain only decimal digits.
 */
export function toCents(value: CentsInput, fieldName = "amount"): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${fieldName} must be a safe integer number of cents`);
    }
    return BigInt(value);
  }

  if (!/^\d+$/.test(value)) {
    throw new TypeError(`${fieldName} must be an integer number of cents`);
  }

  return BigInt(value);
}

export function assertPositiveCents(value: bigint, fieldName = "amount"): void {
  if (value <= 0n) {
    throw new RangeError(`${fieldName} must be greater than zero`);
  }
}

/** Parse the public API amount contract before it enters the bigint domain. */
export function parseAmountCents(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError("amount must be an integer number of cents");
  }

  const amount = BigInt(value);
  assertPositiveCents(amount);
  if (amount > MAX_AMOUNT_CENTS) {
    throw new RangeError(`amount must not exceed ${MAX_AMOUNT_CENTS.toString()} cents`);
  }
  return amount;
}

export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

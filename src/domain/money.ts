/** Integer cents are the only representation used inside the domain layer. */
export type Cents = bigint;

export type CentsInput = bigint | number | string;

/**
 * Convert an external integer-cent value to the domain representation.
 * Numbers must be safe integers; strings may contain only decimal digits.
 */
export function toCents(value: CentsInput, fieldName = "amount"): Cents {
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

export function assertPositiveCents(value: Cents, fieldName = "amount"): void {
  if (value <= 0n) {
    throw new RangeError(`${fieldName} must be greater than zero`);
  }
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0n);
}


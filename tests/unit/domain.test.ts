import { describe, expect, it } from "vitest";
import {
  assertPlanInvariant,
  buildInstallmentPlan,
  dueDateForInstallment,
  splitInstallments,
} from "../../src/domain/installments";
import { assertPositiveCents, MAX_AMOUNT_CENTS, parseAmountCents, toCents } from "../../src/domain/money";

describe("installment domain", () => {
  it("splits uneven cents into positive values that close exactly", () => {
    const result = splitInstallments(10_001, 3);
    expect(result).toEqual([3334n, 3334n, 3333n]);
    assertPlanInvariant(10_001, buildInstallmentPlan(10_001, 3, "2026-01-01"), 3);
  });

  it("rejects unsupported plans and amounts below the installment count", () => {
    expect(() => splitInstallments(100, 4)).toThrow("one of 3, 6, or 12");
    expect(() => splitInstallments(2, 3)).toThrow("at least the number");
  });

  it("anchors due dates at 30-day intervals", () => {
    expect(dueDateForInstallment("2026-01-01", 1)).toBe("2026-01-01");
    expect(dueDateForInstallment("2026-01-01", 3)).toBe("2026-03-02");
  });

  it("rejects invalid cent values and dates", () => {
    expect(toCents("10001")).toBe(10001n);
    expect(() => toCents(Number.MAX_SAFE_INTEGER + 1)).toThrow("safe integer");
    expect(() => toCents("10.5")).toThrow("integer number of cents");
    expect(() => assertPositiveCents(0n)).toThrow("greater than zero");
    expect(() => dueDateForInstallment("2026-01-01", 0)).toThrow("positive integer");
    expect(() => dueDateForInstallment("not-a-date", 1)).toThrow("valid date");
    expect(() => buildInstallmentPlan(10001, 3, "not-a-date")).toThrow("valid date");
  });

  it("accepts only bounded integer numbers at the public amount boundary", () => {
    expect(parseAmountCents(Number(MAX_AMOUNT_CENTS))).toBe(MAX_AMOUNT_CENTS);
    expect(() => parseAmountCents("10000")).toThrow("integer number of cents");
    expect(() => parseAmountCents(10.5)).toThrow("integer number of cents");
    expect(() => parseAmountCents(0)).toThrow("greater than zero");
    expect(() => parseAmountCents(Number(MAX_AMOUNT_CENTS) + 1)).toThrow("must not exceed");
  });

  it("rejects plans with invalid shape or totals", () => {
    const plan = buildInstallmentPlan(10001, 3, "2026-01-01");
    expect(() => assertPlanInvariant(10001, plan.slice(0, 2), 3)).toThrow("unexpected number");
    expect(() => assertPlanInvariant(10000, plan, 3)).toThrow("does not sum");
    expect(() =>
      assertPlanInvariant(
        10001,
        plan.map((item, index) => (index === 0 ? { ...item, number: 2 } : item)),
        3,
      ),
    ).toThrow("invalid installment");
  });
});

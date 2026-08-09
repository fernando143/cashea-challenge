import { describe, expect, it } from "vitest";
import {
  assertPlanInvariant,
  buildInstallmentPlan,
  dueDateForInstallment,
  splitInstallments,
} from "../../src/domain/installments";

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
});

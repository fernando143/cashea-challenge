import { describe, expect, it } from "vitest";
import { createMoneyFormatter } from "../../frontend/format-money.mjs";

describe("presentation-only money formatting", () => {
  it("formats integer cents using the credit line currency", () => {
    const formatMoney = createMoneyFormatter("en-US");

    expect(formatMoney(12_345, "USD")).toBe("$123.45");
    expect(formatMoney(12_345, "VES")).toContain("123.45");
  });

  it("rejects values that are not integer cents", () => {
    const formatMoney = createMoneyFormatter("en-US");

    expect(() => formatMoney(1.5, "VES")).toThrow("Money must use integer cents");
  });
});

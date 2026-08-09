import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(new URL("../../src/insecure/auth.ts", import.meta.url), "utf8");

describe("security regressions", () => {
  it("keeps authentication signature-verified and identity-bound", () => {
    expect(authSource).toContain("export const authenticate");
    expect(authSource).toContain("jwt.verify");
    expect(authSource).not.toContain("jwt.decode");
    expect(authSource).toContain("env.jwtSecret");
    expect(authSource).not.toContain("req.query.userId");
  });

  it("keeps SQL parameterized and sensitive values out of logs/responses", () => {
    expect(authSource).toContain("WHERE email = $1");
    expect(authSource).not.toMatch(/WHERE email = ['"`]/);
    expect(authSource).not.toContain("card_number");
    expect(authSource).not.toMatch(/console\.log\([^\n]*password/);
  });
});

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { closeTestDb, testDb, truncateTestTables } from "../helpers/test-db";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000011";
const PAYMENT_METHOD_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_PAYMENT_METHOD_ID = "00000000-0000-4000-8000-000000000013";
const PASSWORD = "CasheaDemo!2026";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, "$2b$12$0123456789abcdef012345");

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

type ApiResult = { status: number; body: Record<string, unknown>; headers: Headers };

async function api(path: string, options: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body, headers: response.headers };
}

function tokenFor(userId = USER_ID): string {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: "15m" });
}

function auth(token = tokenFor()): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function seedFixture(): Promise<void> {
  await truncateTestTables();
  await testDb.query(
    `INSERT INTO users (id, email, password_hash, full_name, document_id)
     VALUES ($1, $2, $3, 'Demo User', 'DEMO-0001'),
            ($4, $5, $3, 'Other User', 'DEMO-0011')`,
    [USER_ID, "demo@cashea.local", PASSWORD_HASH, OTHER_USER_ID, "other@cashea.local"],
  );
  await testDb.query(
    `INSERT INTO credit_lines (user_id, credit_limit, available, currency)
     VALUES ($1, 100000, 100000, 'VES'), ($2, 100000, 100000, 'VES')`,
    [USER_ID, OTHER_USER_ID],
  );
  await testDb.query(
    `INSERT INTO payment_methods (id, user_id, brand, last4)
     VALUES ($1, $2, 'visa', '4242'), ($3, $4, 'mastercard', '1111')`,
    [PAYMENT_METHOD_ID, USER_ID, OTHER_PAYMENT_METHOD_ID, OTHER_USER_ID],
  );
}

describe("Cashea API against PostgreSQL", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(seedFixture);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await closeTestDb();
  });

  it("serves the frontend and rejects forged access tokens", async () => {
    const page = await fetch(`${baseUrl}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Cashea checkout");

    const login = await api("/login", {
      method: "POST",
      body: JSON.stringify({ email: "demo@cashea.local", password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));

    const forged = await api("/credit-line", { headers: auth(jwt.sign({ userId: USER_ID }, "wrong-secret")) });
    expect(forged.status).toBe(401);
  });

  it("previews an exact plan without changing available credit", async () => {
    const before = await api("/credit-line", { headers: auth() });
    const preview = await api("/purchases/preview", {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ amount: 10001, installments: 3 }),
    });
    const after = await api("/credit-line", { headers: auth() });

    expect(preview.status).toBe(200);
    expect(preview.body.plan.map((item: { amount: number }) => item.amount)).toEqual([3334, 3334, 3333]);
    expect(after.body).toEqual(before.body);
  });

  it("creates a purchase, returns its plan, and replays the idempotency key", async () => {
    const headers = { ...auth(), "Idempotency-Key": "purchase-1" };
    const created = await api("/purchases", {
      method: "POST",
      headers,
      body: JSON.stringify({ amount: 10000, installments: 3 }),
    });
    const replay = await api("/purchases", {
      method: "POST",
      headers,
      body: JSON.stringify({ amount: 10000, installments: 3 }),
    });

    expect(created.status).toBe(201);
    expect(replay).toMatchObject({ status: 201, body: created.body });
    expect(created.body.available).toBe(93334);
    expect(created.body.purchase.installmentsPlan[0].status).toBe("paid");
  });

  it("pays a pending installment once and rejects a new duplicate request", async () => {
    const purchase = await api("/purchases", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "purchase-payment" },
      body: JSON.stringify({ amount: 9000, installments: 3 }),
    });
    const pending = purchase.body.purchase.installmentsPlan[1];
    const pay = await api(`/purchases/${purchase.body.purchase.id}/installments/${pending.id}/pay`, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "payment-1" },
    });
    const replay = await api(`/purchases/${purchase.body.purchase.id}/installments/${pending.id}/pay`, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "payment-1" },
    });
    const duplicate = await api(`/purchases/${purchase.body.purchase.id}/installments/${pending.id}/pay`, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "payment-2" },
    });

    expect(pay.status).toBe(200);
    expect(pay.body.available).toBe(97000);
    expect(replay).toMatchObject({ status: 200, body: pay.body });
    expect(duplicate.status).toBe(409);
  });

  it("returns a uniform 404 for a purchase owned by another user", async () => {
    const created = await api("/purchases", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "ownership-purchase" },
      body: JSON.stringify({ amount: 3000, installments: 3 }),
    });
    const foreign = await api(`/purchases/${created.body.purchase.id}`, { headers: auth(tokenFor(OTHER_USER_ID)) });
    expect(foreign).toMatchObject({ status: 404, body: { error: "Purchase not found" } });
  });

  it("serializes concurrent purchases without overspending credit", async () => {
    const results = await Promise.all(
      ["concurrent-a", "concurrent-b"].map((key) =>
        api("/purchases", {
          method: "POST",
          headers: { ...auth(), "Idempotency-Key": key },
          body: JSON.stringify({ amount: 70000, installments: 3 }),
        }),
      ),
    );
    const statuses = results.map((result) => result.status).sort();
    const credit = await api("/credit-line", { headers: auth() });
    const count = await testDb.query<{ count: string }>("SELECT count(*) FROM purchases WHERE user_id = $1", [USER_ID]);

    expect(statuses).toEqual([201, 409]);
    expect(credit.body.available).toBe(53334);
    expect(count.rows[0]?.count).toBe("1");
  });
});

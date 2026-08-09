import { Pool } from "pg";
import { env } from "../../src/config/env";

export const testDb = new Pool({
  host: env.pgHost,
  port: env.pgPort,
  user: env.pgUser,
  password: env.pgPassword,
  database: env.pgDatabase,
});

/** Reset committed data while preserving the migration table and schema. */
export async function truncateTestTables(): Promise<void> {
  await testDb.query(
    "TRUNCATE TABLE installments, purchases, payment_methods, credit_lines, idempotency_keys, users RESTART IDENTITY CASCADE",
  );
}

export async function closeTestDb(): Promise<void> {
  await testDb.end();
}

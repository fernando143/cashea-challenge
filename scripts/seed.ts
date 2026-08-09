import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loadEnvFile, pgConfig } from "./env";

const demoUserId = "00000000-0000-4000-8000-000000000001";
const demoCreditLineId = "00000000-0000-4000-8000-000000000002";
const demoPaymentMethodId = "00000000-0000-4000-8000-000000000003";

async function main(): Promise<void> {
  loadEnvFile(process.env.PGDATABASE === "cashea_test" ? ".env.test" : ".env");
  const demoEmail = process.env.SEED_EMAIL;
  const demoPassword = process.env.SEED_PASSWORD;
  if (!demoEmail || !demoPassword) {
    throw new Error("SEED_EMAIL and SEED_PASSWORD environment variables are required");
  }
  const demoPasswordHash = bcrypt.hashSync(demoPassword, 12);
  const pool = new Pool(pgConfig());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, document_id)
       VALUES ($1, $2, $3, 'Demo User', 'DEMO-0001')
       ON CONFLICT (id) DO NOTHING`,
      [demoUserId, demoEmail, demoPasswordHash],
    );
    await client.query(
      `INSERT INTO credit_lines (id, user_id, credit_limit, available, currency)
       VALUES ($1, $2, 100000, 100000, 'VES')
       ON CONFLICT (user_id) DO NOTHING`,
      [demoCreditLineId, demoUserId],
    );
    await client.query(
      `INSERT INTO payment_methods (id, user_id, brand, last4)
       VALUES ($1, $2, 'visa', '4242')
       ON CONFLICT (user_id) DO NOTHING`,
      [demoPaymentMethodId, demoUserId],
    );
    await client.query("COMMIT");
    console.log(`Seeded ${demoEmail} (${demoUserId})`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

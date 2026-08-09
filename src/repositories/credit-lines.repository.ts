import type { Queryable } from "./types";

export interface CreditLineRecord {
  id: string;
  user_id: string;
  credit_limit: string;
  available: string;
  currency: string;
}

export async function findCreditLineByUserId(
  client: Queryable,
  userId: string,
): Promise<CreditLineRecord | undefined> {
  const result = await client.query<CreditLineRecord>(
    `SELECT id, user_id, credit_limit, available, currency
       FROM credit_lines WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0];
}

/** Reserve the full purchase amount atomically. The row lock lasts until commit. */
export async function reserveCredit(
  client: Queryable,
  userId: string,
  amount: bigint,
): Promise<CreditLineRecord | undefined> {
  const result = await client.query<CreditLineRecord>(
    `UPDATE credit_lines
        SET available = available - $2
      WHERE user_id = $1 AND available >= $2
      RETURNING id, user_id, credit_limit, available, currency`,
    [userId, amount.toString()],
  );
  return result.rows[0];
}

export async function restoreCredit(
  client: Queryable,
  userId: string,
  amount: bigint,
): Promise<CreditLineRecord | undefined> {
  const result = await client.query<CreditLineRecord>(
    `UPDATE credit_lines
        SET available = available + $2
      WHERE user_id = $1
      RETURNING id, user_id, credit_limit, available, currency`,
    [userId, amount.toString()],
  );
  return result.rows[0];
}

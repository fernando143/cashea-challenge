import type { Queryable } from "./types";

export type IdempotencyOperation = "purchase" | "payment";

export interface IdempotencyRecord {
  id: string;
  user_id: string;
  operation: IdempotencyOperation;
  key: string;
  request_hash: string | null;
  response_code: string | null;
  response_body: unknown;
}

export type IdempotencyReservation =
  | { kind: "new"; id: string }
  | { kind: "replay"; code: string; body: unknown }
  | { kind: "in_progress" }
  | { kind: "different_request" };

export async function reserveIdempotency(
  client: Queryable,
  userId: string,
  operation: IdempotencyOperation,
  key: string,
  requestHash: string,
): Promise<IdempotencyReservation> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO idempotency_keys (user_id, operation, key, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, operation, key) DO NOTHING
     RETURNING id`,
    [userId, operation, key, requestHash],
  );
  if (inserted.rows[0]) return { kind: "new", id: inserted.rows[0].id };

  const existing = await client.query<IdempotencyRecord>(
    `SELECT id, user_id, operation, key, request_hash, response_code, response_body
       FROM idempotency_keys
      WHERE user_id = $1 AND operation = $2 AND key = $3
      FOR UPDATE`,
    [userId, operation, key],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error("Idempotency reservation disappeared after a uniqueness conflict");
  }
  if (row.request_hash !== requestHash) {
    return { kind: "different_request" };
  }
  if (row.response_code !== null && row.response_body !== null) {
    return { kind: "replay", code: row.response_code, body: row.response_body };
  }
  return { kind: "in_progress" };
}

export async function completeIdempotency(
  client: Queryable,
  id: string,
  code: string,
  body: unknown,
): Promise<void> {
  const result = await client.query(
    `UPDATE idempotency_keys SET response_code = $2, response_body = $3
      WHERE id = $1`,
    [id, code, JSON.stringify(body)],
  );
  if (result.rowCount !== 1) {
    throw new Error("Idempotency reservation could not be completed");
  }
}

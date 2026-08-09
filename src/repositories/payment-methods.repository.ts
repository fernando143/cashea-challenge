import type { Queryable } from "./types";

export interface PaymentMethodRecord {
  id: string;
  user_id: string;
  brand: string;
  last4: string;
}

export async function findPaymentMethodByUserId(
  client: Queryable,
  userId: string,
): Promise<PaymentMethodRecord | undefined> {
  const result = await client.query<PaymentMethodRecord>(
    `SELECT id, user_id, brand, last4 FROM payment_methods
      WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  return result.rows[0];
}

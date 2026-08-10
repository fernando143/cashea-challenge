import type { Queryable } from "./types";

export interface PurchaseRecord {
  id: string;
  user_id: string;
  payment_method_id: string;
  amount: string;
  installments: number;
  created_at: Date | string;
}

export interface PurchaseDetailsRecord extends PurchaseRecord {
  brand: string;
  last4: string;
}

export async function createPurchase(
  client: Queryable,
  input: { userId: string; paymentMethodId: string; amount: bigint; installments: number },
): Promise<PurchaseRecord> {
  const result = await client.query<PurchaseRecord>(
    `INSERT INTO purchases (user_id, payment_method_id, amount, installments)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, payment_method_id, amount, installments, created_at`,
    [input.userId, input.paymentMethodId, input.amount.toString(), input.installments],
  );
  return result.rows[0]!;
}

export async function findPurchaseOwned(
  client: Queryable,
  userId: string,
  purchaseId: string,
): Promise<PurchaseDetailsRecord | undefined> {
  const result = await client.query<PurchaseDetailsRecord>(
    `SELECT p.id, p.user_id, p.payment_method_id, p.amount, p.installments,
            p.created_at, pm.brand, pm.last4
       FROM purchases p
       JOIN payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.id = $1 AND p.user_id = $2`,
    [purchaseId, userId],
  );
  return result.rows[0];
}

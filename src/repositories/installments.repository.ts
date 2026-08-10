import type { Queryable } from "./types";

export interface InstallmentRecord {
  id: string;
  purchase_id: string;
  number: number;
  amount: string;
  due_date: string | Date;
  status: "pending" | "paid";
  paid_at: Date | string | null;
}

export async function createInstallments(
  client: Queryable,
  purchaseId: string,
  items: readonly { number: number; amount: bigint; dueDate: string; paid: boolean; paidAt: Date | null }[],
): Promise<void> {
  for (const item of items) {
    await client.query(
      `INSERT INTO installments
         (purchase_id, number, amount, due_date, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        purchaseId,
        item.number,
        item.amount.toString(),
        item.dueDate,
        item.paid ? "paid" : "pending",
        item.paidAt,
      ],
    );
  }
}

export async function findInstallmentsByPurchaseId(
  client: Queryable,
  purchaseId: string,
): Promise<InstallmentRecord[]> {
  const result = await client.query<InstallmentRecord>(
    `SELECT id, purchase_id, number, amount, due_date, status, paid_at
       FROM installments WHERE purchase_id = $1 ORDER BY number ASC`,
    [purchaseId],
  );
  return result.rows;
}

export async function findOwnedInstallment(
  client: Queryable,
  userId: string,
  purchaseId: string,
  installmentId: string,
): Promise<InstallmentRecord | undefined> {
  const result = await client.query<InstallmentRecord>(
    `SELECT i.id, i.purchase_id, i.number, i.amount, i.due_date, i.status, i.paid_at
       FROM installments i
       JOIN purchases p ON p.id = i.purchase_id
      WHERE i.id = $1 AND i.purchase_id = $2 AND p.user_id = $3
      FOR UPDATE`,
    [installmentId, purchaseId, userId],
  );
  return result.rows[0];
}

export async function markInstallmentPaid(
  client: Queryable,
  installmentId: string,
): Promise<InstallmentRecord | undefined> {
  const result = await client.query<InstallmentRecord>(
    `UPDATE installments
        SET status = 'paid', paid_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, purchase_id, number, amount, due_date, status, paid_at`,
    [installmentId],
  );
  return result.rows[0];
}

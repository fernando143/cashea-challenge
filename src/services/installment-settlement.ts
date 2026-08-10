import { restoreCredit, type CreditLineRecord } from "../repositories/credit-lines.repository";
import { markInstallmentPaid, type InstallmentRecord } from "../repositories/installments.repository";
import type { Queryable } from "../repositories/types";
import { ApplicationError } from "./application-error";

export interface InstallmentSettlement {
  installment: InstallmentRecord;
  credit: CreditLineRecord;
}

export async function settleInstallment(
  client: Queryable,
  userId: string,
  installment: InstallmentRecord,
): Promise<InstallmentSettlement> {
  if (installment.status === "paid") {
    throw new ApplicationError("ALREADY_PAID", "Installment is already paid");
  }
  const paid = await markInstallmentPaid(client, installment.id);
  if (!paid) throw new ApplicationError("ALREADY_PAID", "Installment is already paid");

  const credit = await restoreCredit(client, userId, BigInt(installment.amount));
  if (!credit) {
    throw new ApplicationError("CREDIT_UPDATE_FAILED", "Credit line could not be updated");
  }
  return { installment: paid, credit };
}

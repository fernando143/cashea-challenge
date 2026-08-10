import { findCreditLineByUserId, type CreditLineRecord } from "../repositories/credit-lines.repository";
import type { Queryable } from "../repositories/types";
import { ApplicationError } from "./application-error";

export interface CreditLineService {
  get(userId: string): Promise<CreditLineRecord>;
}

export function createCreditLineService(database: Queryable): CreditLineService {
  return {
    async get(userId) {
      const credit = await findCreditLineByUserId(database, userId);
      if (!credit) throw new ApplicationError("NOT_FOUND", "Credit line not found");
      return credit;
    },
  };
}

import type { RequestHandler } from "express";
import { presentCents } from "../http/presenters";
import { authenticatedUserId } from "../http/request";
import type { CreditLineService } from "../services/credit-line.service";

export function createCreditLineController(service: CreditLineService): RequestHandler {
  return async (request, response) => {
    const credit = await service.get(authenticatedUserId(request));
    response.json({
      creditLimit: presentCents(credit.credit_limit),
      available: presentCents(credit.available),
      currency: credit.currency,
    });
  };
}

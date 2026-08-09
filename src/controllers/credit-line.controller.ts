import type { Request, Response } from "express";
import { AppError } from "../http/errors";
import { getAvailableCredit } from "../services/payment.service";
import { sendControllerError } from "./api-error";

function userId(req: Request): string {
  if (!req.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  return req.userId;
}

export async function getCreditLineController(req: Request, res: Response): Promise<void> {
  try {
    res.json(await getAvailableCredit(userId(req)));
  } catch (error) {
    sendControllerError(res, error);
  }
}

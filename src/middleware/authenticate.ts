import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export type AuthenticatedRequest = Request & { userId: string };

type AuthenticatedPayload = jwt.JwtPayload & { userId: string };

function isAuthenticatedPayload(value: string | jwt.JwtPayload): value is AuthenticatedPayload {
  return typeof value !== "string" && typeof value.userId === "string" && value.userId.length > 0;
}

export const authenticate: RequestHandler = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (!isAuthenticatedPayload(decoded)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
};

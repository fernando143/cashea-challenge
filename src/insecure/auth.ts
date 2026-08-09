import express, { type Request, type RequestHandler } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db } from "../config/db";
import { env } from "../config/env";

/* eslint-disable @typescript-eslint/no-namespace -- Express requires namespace augmentation for request context. */
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

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

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  try {
    const user = await db.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email],
    );
    if (
      user.rows.length === 0 ||
      !(await bcrypt.compare(password, user.rows[0]!.password_hash))
    ) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = jwt.sign({ userId: user.rows[0]!.id }, env.jwtSecret, {
      expiresIn: "15m",
    });
    res.json({ token });
  } catch (error) {
    console.error("Error in POST /login", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

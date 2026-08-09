import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db } from "../config/db";
import { env } from "../config/env";

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

export { authenticate } from "../middleware/authenticate";
export default router;

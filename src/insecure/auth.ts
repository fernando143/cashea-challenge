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

// Login
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await db.query(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email]
    );
    if (
      user.rows.length === 0 ||
      !(await bcrypt.compare(password, user.rows[0].password_hash))
    ) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ userId: user.rows[0].id }, env.jwtSecret, {
      expiresIn: "15m",
    });
    return res.json({ token });
  } catch (err) {
    console.error("Error in POST /login", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Middleware de autenticación
function authenticate(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded === "string" || typeof decoded.userId !== "number") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Consulta de línea de crédito
router.get("/credit-line", authenticate, async (req: any, res) => {
  const userId = req.userId;
  try {
    const result = await db.query(
      `SELECT credit_limit, available_credit FROM credit_lines WHERE user_id = $1`,
      [userId]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error in GET /credit-line", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

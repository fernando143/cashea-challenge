import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
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
  const token = jwt.sign({ userId: user.rows[0].id }, JWT_SECRET);
  return res.json({ token });
});

// Middleware de autenticación
function authenticate(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Consulta de línea de crédito
router.get("/credit-line", authenticate, async (req: any, res) => {
  const userId = req.userId;
  const result = await db.query(
    `SELECT credit_limit, available_credit FROM credit_lines WHERE user_id = $1`,
    [userId]
  );
  return res.json(result.rows[0]);
});

export default router;

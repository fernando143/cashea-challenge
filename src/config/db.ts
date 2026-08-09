import { Pool } from "pg";
import { env } from "./env";

export const db = new Pool({
  host: env.pgHost,
  port: env.pgPort,
  user: env.pgUser,
  password: env.pgPassword,
  database: env.pgDatabase,
});

db.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

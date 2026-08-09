/**
 * Centralized environment configuration.
 * Values are read once at startup; no validation library yet since this step
 * only needs PORT for the health check. DB connection vars (PGHOST, PGPORT,
 * PGUSER, PGPASSWORD, PGDATABASE) are declared in .env.example for
 * docker-compose wiring and will be consumed individually by `pg.Pool` once
 * the data layer is implemented — no DATABASE_URL string, those vars are the
 * single source of truth for the connection.
 */

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
};

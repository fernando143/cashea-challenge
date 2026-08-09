/**
 * Centralized environment configuration.
 * Values are read once at startup; no validation library yet, just
 * `requireEnv` for vars that must be present (throws early instead of
 * failing later with an unclear error). DB connection vars (PGHOST, PGPORT,
 * PGUSER, PGPASSWORD, PGDATABASE) are declared in .env.example for
 * docker-compose wiring and are consumed individually by the shared `pg.Pool` —
 * no DATABASE_URL string, those vars are the single source of truth for the
 * connection.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwtSecret: requireEnv("JWT_SECRET"),
  pgHost: requireEnv("PGHOST"),
  pgPort: Number(requireEnv("PGPORT")),
  pgUser: requireEnv("PGUSER"),
  pgPassword: requireEnv("PGPASSWORD"),
  pgDatabase: requireEnv("PGDATABASE"),
};

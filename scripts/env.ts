import { readFileSync, existsSync } from "node:fs";
import type { ClientConfig } from "pg";

/** Load simple KEY=VALUE files without adding a dotenv runtime dependency. */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] ??= value;
  }
}

export function pgConfig(): ClientConfig {
  const required = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} environment variable is required`);
  }

  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  };
}

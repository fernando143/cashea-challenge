import { Client } from "pg";
import { runner } from "node-pg-migrate";
import { loadEnvFile, pgConfig } from "./env";

async function main(): Promise<void> {
  loadEnvFile(".env.test");
  const config = pgConfig();
  const testDatabase = config.database;
  if (!testDatabase) throw new Error("PGDATABASE is required");
  if (testDatabase === "cashea") {
    throw new Error("Integration tests must use the separate cashea_test database");
  }

  const admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  try {
    const result = await admin.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [testDatabase],
    );
    if (!result.rows[0]?.exists) {
      const identifier = `"${testDatabase.replaceAll('"', '""')}"`;
      await admin.query(`CREATE DATABASE ${identifier}`);
    }
  } finally {
    await admin.end();
  }

  await runner({
    direction: "up",
    databaseUrl: config,
    dir: "migrations",
    migrationsTable: "pgmigrations",
    singleTransaction: true,
    checkOrder: true,
    verbose: true,
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

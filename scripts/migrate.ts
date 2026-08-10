import { runner } from "node-pg-migrate";
import { loadEnvFile, pgConfig } from "./env";

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  throw new Error("Usage: npm run migrate:up|migrate:down");
}
const migrationDirection: "up" | "down" = direction;

async function main(): Promise<void> {
  loadEnvFile(process.env.PGDATABASE === "cashea_test" ? ".env.test" : ".env");

  await runner({
    direction: migrationDirection,
    databaseUrl: pgConfig(),
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

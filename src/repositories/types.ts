import type { Pool, PoolClient } from "pg";

export type DbClient = Pool | PoolClient;
export type Queryable = Pick<DbClient, "query">;
export type Database = Pick<Pool, "connect" | "query">;

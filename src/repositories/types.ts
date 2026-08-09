import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export type DbClient = Pool | PoolClient;
export type Queryable = Pick<DbClient, "query">;
export type QueryableResult<T extends QueryResultRow> = QueryResult<T>;

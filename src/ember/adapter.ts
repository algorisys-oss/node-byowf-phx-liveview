/**
 * Ember Adapter -- Database adapter interface.
 *
 * Equivalent to Ecto.Adapter in Elixir.
 * Defines the contract that any database backend must implement.
 * This allows swapping between SQLite, PostgreSQL, etc.
 */

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Adapter {
  /** Execute a query and return all matching rows. */
  all<T = Record<string, unknown>>(sql: string, params: unknown[]): T[];

  /** Execute a query and return the first row or null. */
  get<T = Record<string, unknown>>(sql: string, params: unknown[]): T | null;

  /** Execute an insert/update/delete and return changes info. */
  run(sql: string, params: unknown[]): RunResult;

  /** Execute raw SQL (DDL, multiple statements). */
  exec(sql: string): void;

  /** Run a function inside a database transaction. */
  transaction<T>(fn: () => T): T;

  /** Close the adapter connection. */
  close(): void;
}

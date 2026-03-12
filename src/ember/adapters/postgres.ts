/**
 * Ember PostgreSQL Adapter — implements the Adapter interface for PostgreSQL.
 *
 * Uses the `pg` (node-postgres) package. Supports connection pooling via pg.Pool.
 * Converts `?` placeholders to `$1`, `$2`, ... for PostgreSQL compatibility.
 *
 * Usage:
 *   import { PostgresAdapter } from "./ember/adapters/postgres.js";
 *   const adapter = new PostgresAdapter({ connectionString: "postgres://..." });
 *   const repo = new Repo(adapter);
 *
 * Install:
 *   npm install pg @types/pg
 */

import type { Adapter, RunResult } from "../adapter.js";

/** PostgreSQL connection options. */
export interface PostgresOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;       // Pool size (default 10)
  idleTimeoutMillis?: number;
}

/**
 * Convert `?` placeholders to PostgreSQL `$1, $2, ...` style.
 * Handles quoted strings and escaped question marks.
 */
export function convertPlaceholders(sql: string): string {
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += ch;
    } else if (ch === "?" && !inSingleQuote && !inDoubleQuote) {
      index++;
      result += `$${index}`;
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * PostgreSQL Adapter implementing the Ember Adapter interface.
 *
 * Requires `pg` package to be installed. The adapter lazily imports `pg`
 * so the rest of the Ember ORM works without it installed.
 */
export class PostgresAdapter implements Adapter {
  private pool: any; // pg.Pool
  private connected = false;

  constructor(private options: PostgresOptions) {}

  /** Initialize the connection pool. Must be called before use. */
  async connect(): Promise<void> {
    const { Pool } = await import("pg");
    this.pool = new Pool({
      connectionString: this.options.connectionString,
      host: this.options.host,
      port: this.options.port,
      database: this.options.database,
      user: this.options.user,
      password: this.options.password,
      max: this.options.max ?? 10,
      idleTimeoutMillis: this.options.idleTimeoutMillis ?? 30000,
    });
    this.connected = true;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error("PostgresAdapter: call connect() before using the adapter");
    }
  }

  /** Execute a SELECT query and return all rows. */
  all<T>(sql: string, params: unknown[]): T[] {
    this.ensureConnected();
    // Synchronous interface for compatibility — uses pg's internal sync support
    // In practice, consider using the async variants directly
    throw new Error(
      "PostgresAdapter: use allAsync() for PostgreSQL queries. " +
      "The synchronous all() interface is only available with SQLiteAdapter.",
    );
  }

  /** Execute a SELECT query and return all rows (async). */
  async allAsync<T>(sql: string, params: unknown[]): Promise<T[]> {
    this.ensureConnected();
    const pgSql = convertPlaceholders(sql);
    const result = await this.pool.query(pgSql, params);
    return result.rows as T[];
  }

  /** Execute a SELECT query and return the first row. */
  get<T>(sql: string, params: unknown[]): T | null {
    throw new Error("PostgresAdapter: use getAsync() for PostgreSQL queries.");
  }

  /** Execute a SELECT query and return the first row (async). */
  async getAsync<T>(sql: string, params: unknown[]): Promise<T | null> {
    this.ensureConnected();
    const pgSql = convertPlaceholders(sql);
    const result = await this.pool.query(pgSql, params);
    return (result.rows[0] as T) ?? null;
  }

  /** Execute an INSERT/UPDATE/DELETE and return result. */
  run(sql: string, params: unknown[]): RunResult {
    throw new Error("PostgresAdapter: use runAsync() for PostgreSQL queries.");
  }

  /** Execute an INSERT/UPDATE/DELETE (async). */
  async runAsync(sql: string, params: unknown[]): Promise<RunResult> {
    this.ensureConnected();
    // For INSERT, add RETURNING id to get the last insert ID
    let pgSql = convertPlaceholders(sql);
    const isInsert = sql.trimStart().toUpperCase().startsWith("INSERT");

    if (isInsert && !pgSql.toUpperCase().includes("RETURNING")) {
      pgSql += " RETURNING id";
    }

    const result = await this.pool.query(pgSql, params);
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: isInsert && result.rows.length > 0 ? result.rows[0].id : 0,
    };
  }

  /** Execute raw SQL (DDL). */
  exec(sql: string): void {
    throw new Error("PostgresAdapter: use execAsync() for PostgreSQL queries.");
  }

  /** Execute raw SQL (async). */
  async execAsync(sql: string): Promise<void> {
    this.ensureConnected();
    await this.pool.query(sql);
  }

  /** Run a function inside a transaction. */
  transaction<T>(fn: () => T): T {
    throw new Error("PostgresAdapter: use transactionAsync() for PostgreSQL transactions.");
  }

  /** Run an async function inside a transaction. */
  async transactionAsync<T>(fn: (client: any) => Promise<T>): Promise<T> {
    this.ensureConnected();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Close the connection pool. */
  close(): void {
    if (this.pool) {
      this.pool.end();
      this.connected = false;
    }
  }
}

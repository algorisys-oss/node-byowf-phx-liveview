/**
 * Ember SQLite Adapter -- better-sqlite3 implementation.
 *
 * Synchronous SQLite adapter using better-sqlite3.
 * WAL mode enabled for better concurrent read performance.
 */

import BetterSqlite3 from "better-sqlite3";
import type { Adapter, RunResult } from "../adapter.js";

export class SQLiteAdapter implements Adapter {
  private db: BetterSqlite3.Database;

  constructor(path: string) {
    this.db = new BetterSqlite3(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[]): T | null {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }

  run(sql: string, params: unknown[]): RunResult {
    const result = this.db.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

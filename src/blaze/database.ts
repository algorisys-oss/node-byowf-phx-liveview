/**
 * Blaze Database -- SQLite integration via better-sqlite3.
 *
 * Provides a thin wrapper around better-sqlite3 with:
 * - Named database instances
 * - WAL mode by default for better concurrent read performance
 * - Simple query helpers (all, get, run, exec)
 * - Migration support with version tracking
 */

import BetterSqlite3 from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export class Database {
  readonly db: BetterSqlite3.Database;
  readonly name: string;

  constructor(path: string, name: string = "default") {
    this.name = name;
    this.db = new BetterSqlite3(path);
    // Enable WAL mode for better performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** Execute a query and return all rows. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** Execute a query and return the first row. */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }

  /** Execute a query and return changes info. */
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /** Execute raw SQL (multiple statements, no params). */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Run migrations. Creates schema_migrations table if needed. */
  migrate(migrations: Migration[]): { applied: string[] } {
    this.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied: string[] = [];
    const existing = new Set(
      this.all<{ version: number }>("SELECT version FROM schema_migrations")
        .map((r) => r.version),
    );

    // Sort by version and apply missing ones
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sorted) {
      if (existing.has(m.version)) continue;

      this.db.transaction(() => {
        this.exec(m.up);
        this.run(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
          m.version,
          m.name,
        );
      })();

      applied.push(`${m.version}_${m.name}`);
    }

    return { applied };
  }

  /** Rollback a specific migration version. */
  rollback(migrations: Migration[], version: number): boolean {
    const m = migrations.find((m) => m.version === version);
    if (!m) return false;

    const exists = this.get(
      "SELECT version FROM schema_migrations WHERE version = ?",
      version,
    );
    if (!exists) return false;

    this.db.transaction(() => {
      this.exec(m.down);
      this.run("DELETE FROM schema_migrations WHERE version = ?", version);
    })();

    return true;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

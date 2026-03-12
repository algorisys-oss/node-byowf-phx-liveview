/**
 * Ember Migrations — schema evolution with up/down functions.
 *
 * Equivalent to Ecto.Migration in Elixir.
 *
 * Usage:
 *   // priv/migrations/001_create_users.ts
 *   export default defineMigration({
 *     up(m) {
 *       m.createTable("users", {
 *         id: "INTEGER PRIMARY KEY AUTOINCREMENT",
 *         username: "TEXT NOT NULL",
 *         email: "TEXT NOT NULL UNIQUE",
 *       });
 *       m.addIndex("users", ["email"], { unique: true });
 *     },
 *     down(m) {
 *       m.dropTable("users");
 *     },
 *   });
 *
 *   // Run: npx tsx src/ember/migrate.ts
 */

import type { Adapter } from "./adapter.js";

export interface MigrationContext {
  /** Create a table with column definitions. */
  createTable(name: string, columns: Record<string, string>): void;
  /** Drop a table. */
  dropTable(name: string): void;
  /** Add a column to an existing table. */
  addColumn(table: string, column: string, type: string): void;
  /** Rename a table. */
  renameTable(from: string, to: string): void;
  /** Add an index. */
  addIndex(table: string, columns: string[], options?: { unique?: boolean; name?: string }): void;
  /** Drop an index. */
  dropIndex(name: string): void;
  /** Execute raw SQL. */
  execute(sql: string): void;
}

export interface MigrationDef {
  up: (m: MigrationContext) => void;
  down: (m: MigrationContext) => void;
}

export interface Migration {
  version: string;
  name: string;
  up: (m: MigrationContext) => void;
  down: (m: MigrationContext) => void;
}

/** Define a migration with up/down functions. */
export function defineMigration(def: MigrationDef): MigrationDef {
  return def;
}

/** Build a MigrationContext that executes DDL against an adapter. */
function buildContext(adapter: Adapter): MigrationContext {
  return {
    createTable(name, columns) {
      const cols = Object.entries(columns)
        .map(([col, type]) => `${col} ${type}`)
        .join(", ");
      adapter.exec(`CREATE TABLE ${name} (${cols})`);
    },

    dropTable(name) {
      adapter.exec(`DROP TABLE IF EXISTS ${name}`);
    },

    addColumn(table, column, type) {
      adapter.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    },

    renameTable(from, to) {
      adapter.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
    },

    addIndex(table, columns, options = {}) {
      const unique = options.unique ? "UNIQUE " : "";
      const name = options.name ?? `idx_${table}_${columns.join("_")}`;
      adapter.exec(`CREATE ${unique}INDEX ${name} ON ${table} (${columns.join(", ")})`);
    },

    dropIndex(name) {
      adapter.exec(`DROP INDEX IF EXISTS ${name}`);
    },

    execute(sql) {
      adapter.exec(sql);
    },
  };
}

const MIGRATIONS_TABLE = "schema_migrations";

/** Ensure the schema_migrations tracking table exists. */
function ensureMigrationsTable(adapter: Adapter): void {
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version TEXT PRIMARY KEY,
      inserted_at TEXT NOT NULL
    )
  `);
}

/** Get list of already-applied migration versions. */
function getAppliedVersions(adapter: Adapter): Set<string> {
  ensureMigrationsTable(adapter);
  const rows = adapter.all<{ version: string }>(
    `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`,
    [],
  );
  return new Set(rows.map((r) => r.version));
}

/** Run pending migrations (up). Returns list of applied versions. */
export function migrate(adapter: Adapter, migrations: Migration[]): string[] {
  const applied = getAppliedVersions(adapter);
  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version.localeCompare(b.version));

  const results: string[] = [];
  const ctx = buildContext(adapter);

  for (const migration of pending) {
    adapter.transaction(() => {
      migration.up(ctx);
      adapter.run(
        `INSERT INTO ${MIGRATIONS_TABLE} (version, inserted_at) VALUES (?, ?)`,
        [migration.version, new Date().toISOString()],
      );
    });
    results.push(migration.version);
  }

  return results;
}

/** Rollback the last N migrations. Returns list of rolled-back versions. */
export function rollback(adapter: Adapter, migrations: Migration[], steps = 1): string[] {
  const applied = getAppliedVersions(adapter);
  const toRollback = migrations
    .filter((m) => applied.has(m.version))
    .sort((a, b) => b.version.localeCompare(a.version))
    .slice(0, steps);

  const results: string[] = [];
  const ctx = buildContext(adapter);

  for (const migration of toRollback) {
    adapter.transaction(() => {
      migration.down(ctx);
      adapter.run(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`, [migration.version]);
    });
    results.push(migration.version);
  }

  return results;
}

/** Get migration status: which are applied, which are pending. */
export function migrationStatus(adapter: Adapter, migrations: Migration[]): { version: string; name: string; status: "up" | "down" }[] {
  const applied = getAppliedVersions(adapter);
  return migrations
    .sort((a, b) => a.version.localeCompare(b.version))
    .map((m) => ({
      version: m.version,
      name: m.name,
      status: applied.has(m.version) ? "up" as const : "down" as const,
    }));
}

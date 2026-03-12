[← Step 47: Query Builder](47-query-builder.md) | [Step 49: Associations →](49-associations.md)

# Step 48 — Migrations

## What We're Building

A migration system for schema evolution — `defineMigration()` with `up`/`down` functions, a `schema_migrations` tracking table, and `migrate()`/`rollback()` runners. Equivalent to Ecto.Migration.

## Concepts You'll Learn

- **Migrations** — versioned, ordered DDL changes with rollback support
- **Migration context** — DSL for `createTable`, `addColumn`, `addIndex`, etc.
- **Schema tracking** — `schema_migrations` table records which versions have run
- **Transactional DDL** — each migration runs inside a transaction

## How It Works

```
defineMigration({
  up(m) {                              down(m) {
    m.createTable("users", {...})        m.dropTable("users")
    m.addIndex("users", ["email"])     }
  },
})

migrate(adapter, migrations)     → runs pending up() in version order
rollback(adapter, migrations, 1) → runs latest down() in reverse order
migrationStatus(adapter, migrations) → [{ version, name, status: "up"|"down" }]
```

The system maintains a `schema_migrations` table with one row per applied migration. `migrate()` checks which versions are already applied, skips those, and runs the rest in sorted order. `rollback()` does the reverse — it finds the last N applied migrations and runs their `down()` in reverse order.

Each migration runs inside a database transaction. If `up()` throws, the transaction rolls back and the version is not recorded. If `down()` throws, the version is not removed from the tracking table.

## The Code

### `src/ember/migration.ts` — Full implementation

```typescript
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
```

Let's walk through the key pieces:

**`buildContext(adapter)`** creates the DSL object passed to `up()` and `down()`. Each method translates to a single `adapter.exec()` call with raw DDL SQL. The `createTable` method iterates over the `columns` record and joins them into a `CREATE TABLE` statement:

```typescript
createTable(name, columns) {
  const cols = Object.entries(columns)
    .map(([col, type]) => `${col} ${type}`)
    .join(", ");
  adapter.exec(`CREATE TABLE ${name} (${cols})`);
},
```

The `addIndex` method auto-generates an index name from the table and column names if none is provided (`idx_users_email`), and prepends `UNIQUE` when requested.

**`ensureMigrationsTable`** creates the `schema_migrations` table if it does not exist. This table has two columns: `version` (the migration identifier, e.g. `"001"`) and `inserted_at` (ISO timestamp of when it was applied).

**`getAppliedVersions`** queries `schema_migrations` and returns a `Set<string>` of all versions that have already been run. This Set is used by `migrate()`, `rollback()`, and `migrationStatus()`.

**`migrate()`** filters the full migration list to only those not in the applied set, sorts by version, then runs each one inside a transaction. Inside the transaction it calls `migration.up(ctx)` to execute the DDL, then inserts a row into `schema_migrations`. If `up()` throws, the transaction rolls back and the version is never recorded.

**`rollback()`** does the reverse: filters to only applied migrations, sorts in reverse order (newest first), takes the first N, and for each one calls `migration.down(ctx)` inside a transaction, then deletes the row from `schema_migrations`.

**`migrationStatus()`** returns an array of `{ version, name, status }` objects for all known migrations, with `status` being `"up"` if applied or `"down"` if pending.

### Example migration file

```typescript
// priv/migrations/001_create_users.ts
import { defineMigration } from "../src/ember/migration.js";

export default defineMigration({
  up(m) {
    m.createTable("users", {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      username: "TEXT NOT NULL",
      email: "TEXT NOT NULL UNIQUE",
      inserted_at: "TEXT",
      updated_at: "TEXT",
    });
    m.addIndex("users", ["email"], { unique: true });
  },
  down(m) {
    m.dropTable("users");
  },
});
```

### Loading migrations

The `Migration` interface requires a `version` and `name` alongside the `up`/`down` functions. When loading migration files, parse the version and name from the filename:

```typescript
// Example: load migrations from file naming convention "001_create_users.ts"
const migrations: Migration[] = [
  {
    version: "001",
    name: "create_users",
    ...require("./priv/migrations/001_create_users.js"),
  },
];
```

## Try It Out

```bash
npm test
```

10 migration tests pass covering migrate, rollback, status, and all DDL operations.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/migration.ts` | **New** | Migration DSL, runner, rollback, status |
| `test/migration.test.ts` | **New** | 10 tests for all migration operations |

## What's Next

**Step 49 — Associations:** `hasMany()`, `belongsTo()`, and `Repo.preload()` for loading related records.

[← Step 47: Query Builder](47-query-builder.md) | [Step 49: Associations →](49-associations.md)

[← Step 44: Schema & Changeset](44-schema-changeset.md) | [Step 46: Repo Pattern →](46-repo-pattern.md)

# Step 45 — SQLite Adapter

## What We're Building

An abstract database adapter interface and a concrete `better-sqlite3` implementation. This decouples the Repo from any specific database, so you could swap in PostgreSQL, MySQL, or any other backend by implementing the same interface.

## Concepts You'll Learn

- **Adapter pattern** — abstract interface for database operations
- **Dependency inversion** — Repo depends on the Adapter interface, not a concrete implementation
- **WAL mode** — Write-Ahead Logging for better SQLite concurrent read performance
- **Prepared statements** — `better-sqlite3` compiles SQL once, executes many times

## How It Works

The adapter interface defines six operations that any database backend must support:

```
Repo  ──→  Adapter (interface)
              ├── all()         → SELECT, returns rows[]
              ├── get()         → SELECT, returns first row or null
              ├── run()         → INSERT/UPDATE/DELETE, returns { changes, lastInsertRowid }
              ├── exec()        → raw DDL (CREATE TABLE, etc.)
              ├── transaction() → wrap a function in BEGIN/COMMIT/ROLLBACK
              └── close()       → clean up connection
```

The SQLite adapter implements this interface using `better-sqlite3`, a synchronous native SQLite driver that is the fastest SQLite library for Node.js.

## Installation

```bash
npm install better-sqlite3 @types/better-sqlite3
```

## The Code

### `src/ember/adapter.ts` — Adapter interface

This is the abstract contract. Any database backend must implement these methods:

```typescript
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
```

The interface is deliberately simple -- six methods cover all database interactions. The `RunResult` type returns `changes` (number of affected rows) and `lastInsertRowid` (the auto-generated ID for INSERT operations).

`QueryResult` is exported as a convenience type but is not used by the interface itself -- the `all()` and `get()` methods return typed results directly.

### `src/ember/adapters/sqlite.ts` — SQLite implementation

The concrete adapter wraps `better-sqlite3`:

```typescript
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
```

Key implementation details:

- **Constructor** opens the database file (or creates it) and sets two pragmas:
  - `journal_mode = WAL` -- Write-Ahead Logging allows concurrent readers while a writer is active, significantly improving read performance.
  - `foreign_keys = ON` -- SQLite has foreign key support disabled by default. This enables it so `REFERENCES` constraints are enforced.

- **`all()` / `get()`** -- Each call prepares the SQL statement and executes it. `better-sqlite3` caches prepared statements internally, so repeated queries are fast. The `get()` method uses nullish coalescing (`?? null`) to normalize `undefined` (no row found) to `null`.

- **`run()`** -- Returns `changes` (rows affected) and `lastInsertRowid`. The rowid is cast to `Number` because `better-sqlite3` returns it as a `BigInt`.

- **`transaction()`** -- `better-sqlite3` provides a `.transaction()` method that returns a function. We call it immediately with `()` to execute the wrapped function inside `BEGIN`/`COMMIT`, with automatic `ROLLBACK` on errors.

- **`close()`** -- Properly closes the database connection. Important for avoiding file lock issues.

## Try It Out

You can test the adapter directly:

```typescript
import { SQLiteAdapter } from "./src/ember/adapters/sqlite.js";

const adapter = new SQLiteAdapter(":memory:");
adapter.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
adapter.run("INSERT INTO test (name) VALUES (?)", ["Alice"]);
const rows = adapter.all("SELECT * FROM test", []);
console.log(rows); // [{ id: 1, name: "Alice" }]
adapter.close();
```

Use `":memory:"` for an in-memory database (great for tests), or a file path like `"./data/app.db"` for persistent storage.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/adapter.ts` | **New** | Abstract Adapter interface with 6 methods |
| `src/ember/adapters/sqlite.ts` | **New** | `better-sqlite3` implementation with WAL mode |
| `package.json` | **Modified** | Added `better-sqlite3` and `@types/better-sqlite3` |

## What's Next

**Step 46 — Repo Pattern:** `Repo.insert()`, `Repo.get()`, `Repo.all()`, `Repo.update()`, `Repo.delete()` -- the single gateway for all database operations.

[← Step 44: Schema & Changeset](44-schema-changeset.md) | [Step 46: Repo Pattern →](46-repo-pattern.md)

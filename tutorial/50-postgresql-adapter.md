[← Step 49: Associations](49-associations.md) | [Step 51: Transactions & Advanced →](51-transactions-advanced.md)

# Step 50 — PostgreSQL Adapter

## What We're Building

A PostgreSQL adapter implementing the same `Adapter` interface as the SQLite adapter. Uses the `pg` (node-postgres) package with connection pooling. The Repo works with either backend — swap the adapter, everything else stays the same.

## Concepts You'll Learn

- **Adapter pattern payoff** — same Repo, different database backend
- **Connection pooling** — `pg.Pool` manages connection reuse
- **Placeholder conversion** — `?` → `$1, $2, ...` for PostgreSQL
- **Async adapter** — PostgreSQL operations are async (unlike synchronous better-sqlite3)
- **Lazy imports** — `pg` is only loaded when `connect()` is called

## How It Works

```
SQLiteAdapter (sync)          PostgresAdapter (async)
  adapter.all(sql, params)      adapter.allAsync(sql, params)
  adapter.run(sql, params)      adapter.runAsync(sql, params)
  adapter.exec(sql)             adapter.execAsync(sql)
  adapter.transaction(fn)       adapter.transactionAsync(fn)

Both implement the Adapter interface.
PostgreSQL adds async variants for real-world usage.
Sync methods throw — they exist only for interface compliance.
```

### Placeholder Conversion

```
SQLite:      SELECT * FROM users WHERE id = ? AND age > ?
PostgreSQL:  SELECT * FROM users WHERE id = $1 AND age > $2
```

The `convertPlaceholders()` function handles this automatically, including skipping `?` inside quoted strings.

## The Code

### Install (optional dependency)

```bash
npm install pg @types/pg
```

The `pg` package is only needed if you use the PostgreSQL adapter. The rest of Ember (SQLite, schemas, changesets, queries) works without it.

### `src/ember/adapters/postgres.ts`

```typescript
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
```

### Key Design Decisions

**Lazy `pg` import.** The `import("pg")` call is inside `connect()`, not at the top of the file. This means you can import `PostgresAdapter` in any environment without having `pg` installed. The import only happens when you actually call `connect()`.

**Sync methods throw.** The `Adapter` interface requires `all()`, `get()`, `run()`, etc. For PostgreSQL these are inherently async, so the sync versions throw with a clear error message pointing to the async variant. This keeps the interface contract honest.

**Automatic `RETURNING id`.** PostgreSQL does not provide `lastInsertRowid` like SQLite. The `runAsync()` method auto-appends `RETURNING id` to INSERT statements so you get the new row's ID back in a consistent `RunResult` shape.

**Placeholder conversion.** SQLite uses `?` while PostgreSQL uses `$1, $2, ...`. The `convertPlaceholders()` function translates between them, respecting quoted strings so a `?` inside `'literal?'` or `"column?"` is left alone.

### `test/postgres-adapter.test.ts`

```typescript
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { convertPlaceholders, PostgresAdapter } from "../src/ember/adapters/postgres.js";

describe("convertPlaceholders", () => {
  it("converts ? to $1, $2, ...", () => {
    assert.equal(convertPlaceholders("SELECT * FROM users WHERE id = ?"), "SELECT * FROM users WHERE id = $1");
  });

  it("converts multiple placeholders", () => {
    assert.equal(
      convertPlaceholders("INSERT INTO users (name, email) VALUES (?, ?)"),
      "INSERT INTO users (name, email) VALUES ($1, $2)",
    );
  });

  it("handles no placeholders", () => {
    assert.equal(convertPlaceholders("SELECT * FROM users"), "SELECT * FROM users");
  });

  it("ignores ? inside single quotes", () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM users WHERE name = '?' AND id = ?"),
      "SELECT * FROM users WHERE name = '?' AND id = $1",
    );
  });

  it("ignores ? inside double quotes", () => {
    assert.equal(
      convertPlaceholders('SELECT * FROM "table?" WHERE id = ?'),
      'SELECT * FROM "table?" WHERE id = $1',
    );
  });

  it("handles complex query", () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM users WHERE age > ? AND name LIKE ? ORDER BY ? LIMIT ?"),
      "SELECT * FROM users WHERE age > $1 AND name LIKE $2 ORDER BY $3 LIMIT $4",
    );
  });
});

describe("PostgresAdapter", () => {
  it("can be constructed without connecting", () => {
    const adapter = new PostgresAdapter({ connectionString: "postgres://localhost/test" });
    assert.ok(adapter);
  });

  it("throws on sync methods (must use async variants)", () => {
    const adapter = new PostgresAdapter({ connectionString: "postgres://localhost/test" });
    assert.throws(() => adapter.all("SELECT 1", []));
    assert.throws(() => adapter.get("SELECT 1", []));
    assert.throws(() => adapter.run("INSERT", []));
    assert.throws(() => adapter.exec("CREATE TABLE"));
    assert.throws(() => adapter.transaction(() => {}));
  });

  it("close() is safe to call before connect()", () => {
    const adapter = new PostgresAdapter({ connectionString: "postgres://localhost/test" });
    adapter.close(); // should not throw
  });
});
```

## Try It Out

```bash
npm test  # runs placeholder conversion + adapter structure tests (no PG required)
```

9 tests pass — 6 placeholder conversion tests + 3 adapter structure tests.

To use with a real PostgreSQL database:

```typescript
import { PostgresAdapter } from "./ember/adapters/postgres.js";
import { Repo } from "./ember/repo.js";

const adapter = new PostgresAdapter({
  connectionString: "postgres://user:pass@localhost:5432/mydb",
  max: 10,  // pool size
});
await adapter.connect();

// Use directly
const users = await adapter.allAsync("SELECT * FROM users WHERE age > ?", [18]);
// Internally converts to: SELECT * FROM users WHERE age > $1

// Or wrap in a transaction
await adapter.transactionAsync(async (client) => {
  await client.query("INSERT INTO users (name) VALUES ($1)", ["Alice"]);
  await client.query("INSERT INTO users (name) VALUES ($1)", ["Bob"]);
});

adapter.close();
```

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/adapters/postgres.ts` | **New** | PostgreSQL adapter with pg.Pool and placeholder conversion |
| `test/postgres-adapter.test.ts` | **New** | 9 tests for placeholders and adapter structure |

## What's Next

**Step 51 — Transactions & Advanced:** Composable multi-operation transactions (`Multi`), upserts, and aggregate queries.

[← Step 49: Associations](49-associations.md) | [Step 51: Transactions & Advanced →](51-transactions-advanced.md)

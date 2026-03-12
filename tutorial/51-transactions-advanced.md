[← Step 50: PostgreSQL Adapter](50-postgresql-adapter.md) | [Step 52: Ecto.Multi →](52-ecto-multi.md)

# Step 51 — Transactions & Advanced

## What We're Building

The final Ember ORM step: composable multi-operation transactions (`Multi`), upserts (INSERT ... ON CONFLICT), and aggregate queries (count, sum, avg, min, max). Equivalent to Ecto.Multi and Ecto aggregate functions.

## Concepts You'll Learn

- **Multi** — chain insert/update/delete/run steps, execute atomically in one transaction
- **Upsert** — INSERT ... ON CONFLICT ... DO UPDATE for idempotent writes
- **Aggregates** — count, sum, avg, min, max with optional conditions
- **Transaction rollback** — if any Multi step fails, all changes are reverted

## How It Works

### Multi (composable transactions)

```
multi()
  .insert("user", UserSchema, userCs)     ─┐
  .insert("post", PostSchema, postCs)       │  All inside one
  .run("notify", (results) => ...)          │  transaction
  .deleteStep("old", OldSchema, oldId)     ─┘
  .execute(repo)

→ { ok: true, results: { user: {...}, post: {...}, notify: ..., old: true } }

If any step fails:
→ { ok: false, failed: "post", error: changeset, results: { user: {...} } }
   (all database operations rolled back)
```

### Upsert Flow

```
INSERT INTO users (username, email) VALUES (?, ?)
  ON CONFLICT (email) DO UPDATE SET username = excluded.username
```

### Aggregate Flow

```
repo.aggregate(UserSchema, "count")           →  SELECT COUNT(*) as result FROM users
repo.aggregate(UserSchema, "sum", "age")      →  SELECT SUM(age) as result FROM users
repo.aggregate(UserSchema, "avg", "age",
  { active: true })                           →  SELECT AVG(age) as result FROM users WHERE active = ?
```

## The Code

### `src/ember/multi.ts`

```typescript
/**
 * Ember Multi — composable multi-operation transactions.
 *
 * Inspired by Ecto.Multi. Chain multiple operations, then run them
 * all inside a single transaction. If any step fails, the entire
 * transaction rolls back.
 *
 * Usage:
 *   const result = multi()
 *     .insert("user", UserSchema, userChangeset)
 *     .run("welcome_email", (results) => sendEmail(results.user))
 *     .execute(repo);
 *
 *   if (result.ok) {
 *     result.results.user  // inserted user
 *   } else {
 *     result.failed // name of failed step
 *     result.error  // the error or failed changeset
 *   }
 */

import type { Schema } from "./schema.js";
import type { Changeset } from "./changeset.js";
import type { Repo, RepoResult } from "./repo.js";

type StepFn = (results: Record<string, unknown>) => unknown;

interface Step {
  name: string;
  type: "insert" | "update" | "delete" | "run";
  schema?: Schema;
  changeset?: Changeset<any>;
  id?: unknown;
  fn?: StepFn;
}

export type MultiResult =
  | { ok: true; results: Record<string, unknown> }
  | { ok: false; failed: string; error: unknown; results: Record<string, unknown> };

export class Multi {
  private steps: Step[] = [];

  /** Add an insert step. */
  insert(name: string, schema: Schema, cs: Changeset<any>): this {
    this.steps.push({ name, type: "insert", schema, changeset: cs });
    return this;
  }

  /** Add an update step. */
  update(name: string, schema: Schema, cs: Changeset<any>): this {
    this.steps.push({ name, type: "update", schema, changeset: cs });
    return this;
  }

  /** Add a delete step. */
  deleteStep(name: string, schema: Schema, id: unknown): this {
    this.steps.push({ name, type: "delete", schema, id });
    return this;
  }

  /** Add a custom function step. Receives all previous results. */
  run(name: string, fn: StepFn): this {
    this.steps.push({ name, type: "run", fn });
    return this;
  }

  /** Execute all steps inside a transaction. */
  execute(repo: Repo): MultiResult {
    const results: Record<string, unknown> = {};

    try {
      repo.transaction(() => {
        for (const step of this.steps) {
          switch (step.type) {
            case "insert": {
              const result = repo.insert(step.schema!, step.changeset!);
              if (!result.ok) {
                throw { __multi_fail: true, name: step.name, error: result.changeset };
              }
              results[step.name] = result.data;
              break;
            }
            case "update": {
              const result = repo.update(step.schema!, step.changeset!);
              if (!result.ok) {
                throw { __multi_fail: true, name: step.name, error: result.changeset };
              }
              results[step.name] = result.data;
              break;
            }
            case "delete": {
              const deleted = repo.delete(step.schema!, step.id);
              if (!deleted) {
                throw { __multi_fail: true, name: step.name, error: "record not found" };
              }
              results[step.name] = true;
              break;
            }
            case "run": {
              const value = step.fn!(results);
              results[step.name] = value;
              break;
            }
          }
        }
      });

      return { ok: true, results };
    } catch (err: any) {
      if (err?.__multi_fail) {
        return { ok: false, failed: err.name, error: err.error, results };
      }
      throw err; // re-throw unexpected errors
    }
  }
}

/** Create a new Multi chain. */
export function multi(): Multi {
  return new Multi();
}
```

The key trick is the `__multi_fail` sentinel on thrown objects. When a step fails (invalid changeset, record not found), `execute()` throws a tagged object that breaks out of the `repo.transaction()` callback. The `catch` block inspects the thrown value: if it has `__multi_fail`, it is a controlled failure (return `{ ok: false, ... }`). Otherwise, the error is re-thrown as an unexpected exception.

### `src/ember/repo.ts` — New Methods

Three methods were added to the Repo class in this step: `aggregate()`, `upsert()`, and `execute()`.

#### `aggregate()` — count, sum, avg, min, max

```typescript
/**
 * Aggregate query: count, sum, avg, min, max.
 */
aggregate<T = number>(
  schema: Schema,
  agg: "count" | "sum" | "avg" | "min" | "max",
  column = "*",
  conditions: Record<string, unknown> = {},
): T {
  const keys = Object.keys(conditions);
  let sql = `SELECT ${agg.toUpperCase()}(${column}) as result FROM ${schema.tableName}`;
  const params: unknown[] = [];

  if (keys.length > 0) {
    const where = keys.map((k) => `${k} = ?`).join(" AND ");
    params.push(...keys.map((k) => conditions[k]));
    sql += ` WHERE ${where}`;
  }

  const row = this.adapter.get<{ result: T }>(sql, params);
  return row?.result ?? (0 as T);
}
```

Builds a `SELECT AGG(column) as result FROM table [WHERE ...]` query. The optional `conditions` object adds WHERE clauses. Returns the scalar result, defaulting to `0` if null.

#### `upsert()` — INSERT ... ON CONFLICT ... DO UPDATE

```typescript
/**
 * Upsert: insert or update on conflict.
 * For SQLite uses INSERT ... ON CONFLICT(...) DO UPDATE.
 */
upsert<T extends Record<string, unknown>>(
  schema: Schema,
  cs: Changeset<T>,
  conflictColumns: string[],
): RepoResult<T> {
  cs.action = "insert";

  if (!cs.valid) {
    return { ok: false, changeset: cs };
  }

  const now = new Date().toISOString();
  const changes = { ...cs.changes } as Record<string, unknown>;
  if (schema.timestamps) {
    changes.inserted_at = now;
    changes.updated_at = now;
  }

  const keys = Object.keys(changes);
  const placeholders = keys.map(() => "?").join(", ");
  const values = keys.map((k) => changes[k]);

  // Build ON CONFLICT ... DO UPDATE SET
  const updateKeys = keys.filter((k) => !conflictColumns.includes(k));
  const updateSet = updateKeys.map((k) => `${k} = excluded.${k}`).join(", ");

  const sql = `INSERT INTO ${schema.tableName} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updateSet}`;
  const result = this.adapter.run(sql, values);

  const data = { ...cs.data, ...changes, [schema.primaryKey]: result.lastInsertRowid } as T;
  return { ok: true, data };
}
```

The `conflictColumns` parameter specifies which columns trigger the ON CONFLICT clause. All other columns are updated via `excluded.column_name` (SQLite and PostgreSQL both support this syntax).

#### `execute()` — raw SQL statements

```typescript
/** Execute raw SQL statement (INSERT/UPDATE/DELETE). */
execute(sql: string, params: unknown[] = []) {
  return this.adapter.run(sql, params);
}
```

A thin wrapper over `adapter.run()` for one-off SQL statements that don't map to schema operations.

### `test/transactions.test.ts`

```typescript
import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";
import { changeset, validateRequired } from "../src/ember/changeset.js";
import { multi } from "../src/ember/multi.js";

const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
  age: { type: "integer" },
});

let repo: Repo;
let adapter: SQLiteAdapter;

beforeEach(() => {
  adapter = new SQLiteAdapter(":memory:");
  adapter.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      age INTEGER DEFAULT 0,
      inserted_at TEXT,
      updated_at TEXT
    )
  `);
  repo = new Repo(adapter);
});

describe("Repo.transaction", () => {
  it("commits on success", () => {
    repo.transaction(() => {
      const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
      repo.insert(UserSchema, cs1);
      const cs2 = changeset({} as any, { username: "Bob", email: "b@b.com", age: 25 }, ["username", "email", "age"]);
      repo.insert(UserSchema, cs2);
    });
    assert.equal(repo.all(UserSchema).length, 2);
  });

  it("rolls back on error", () => {
    assert.throws(() => {
      repo.transaction(() => {
        const cs = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
        repo.insert(UserSchema, cs);
        throw new Error("boom");
      });
    });
    assert.equal(repo.all(UserSchema).length, 0);
  });
});

describe("Multi", () => {
  it("executes multiple operations atomically", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const cs2 = changeset({} as any, { username: "Bob", email: "b@b.com", age: 25 }, ["username", "email", "age"]);

    const result = multi()
      .insert("alice", UserSchema, cs1)
      .insert("bob", UserSchema, cs2)
      .run("count", () => repo.all(UserSchema).length)
      .execute(repo);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.results.alice as any).username, "Alice");
      assert.equal((result.results.bob as any).username, "Bob");
      assert.equal(result.results.count, 2);
    }
  });

  it("rolls back on failed insert", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const cs2 = changeset({} as any, { email: "b@b.com" }, ["username", "email"]);
    validateRequired(cs2, ["username"]);

    const result = multi()
      .insert("alice", UserSchema, cs1)
      .insert("bob", UserSchema, cs2)
      .execute(repo);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failed, "bob");
    }
    // Transaction rolled back — no records
    assert.equal(repo.all(UserSchema).length, 0);
  });

  it("supports delete steps", () => {
    const cs = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const ins = repo.insert(UserSchema, cs);
    assert.ok(ins.ok);

    const result = multi()
      .deleteStep("remove_alice", UserSchema, ins.ok ? ins.data.id : 0)
      .execute(repo);

    assert.equal(result.ok, true);
    assert.equal(repo.all(UserSchema).length, 0);
  });
});

describe("Repo.aggregate", () => {
  beforeEach(() => {
    repo.insertAll(UserSchema, [
      { username: "Alice", email: "a@b.com", age: 30 },
      { username: "Bob", email: "b@b.com", age: 25 },
      { username: "Charlie", email: "c@b.com", age: 35 },
    ]);
  });

  it("counts records", () => {
    assert.equal(repo.aggregate(UserSchema, "count"), 3);
  });

  it("counts with conditions", () => {
    assert.equal(repo.aggregate(UserSchema, "count", "*", { username: "Alice" }), 1);
  });

  it("sums a column", () => {
    assert.equal(repo.aggregate(UserSchema, "sum", "age"), 90);
  });

  it("averages a column", () => {
    assert.equal(repo.aggregate(UserSchema, "avg", "age"), 30);
  });

  it("gets min/max", () => {
    assert.equal(repo.aggregate(UserSchema, "min", "age"), 25);
    assert.equal(repo.aggregate(UserSchema, "max", "age"), 35);
  });
});

describe("Repo.upsert", () => {
  it("inserts when no conflict", () => {
    const cs = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const result = repo.upsert(UserSchema, cs, ["email"]);
    assert.equal(result.ok, true);
    assert.equal(repo.all(UserSchema).length, 1);
  });

  it("updates on conflict", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    repo.insert(UserSchema, cs1);

    const cs2 = changeset({} as any, { username: "Alice Updated", email: "a@b.com", age: 31 }, ["username", "email", "age"]);
    const result = repo.upsert(UserSchema, cs2, ["email"]);
    assert.equal(result.ok, true);

    const users = repo.all<any>(UserSchema);
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "Alice Updated");
    assert.equal(users[0].age, 31);
  });

  it("rejects invalid changeset", () => {
    const cs = changeset({} as any, { email: "a@b.com" }, ["username", "email"]);
    validateRequired(cs, ["username"]);
    const result = repo.upsert(UserSchema, cs, ["email"]);
    assert.equal(result.ok, false);
  });
});
```

## Try It Out

```bash
npm test
```

83 total tests across the Ember ORM — 13 new tests for transactions, multi, aggregates, and upserts.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/multi.ts` | **New** | Composable Multi transaction chain |
| `src/ember/repo.ts` | **Modified** | Added `aggregate()`, `upsert()`, and `execute()` |
| `test/transactions.test.ts` | **New** | 13 tests for transactions, multi, aggregates, upserts |

## Module 9 Complete!

The Ember ORM now provides a full Ecto-like experience:

| Step | Feature | Ecto Equivalent |
|------|---------|----------------|
| 44 | Schema & Changeset | Ecto.Schema + Ecto.Changeset |
| 45 | SQLite Adapter | Ecto.Adapters.SQL |
| 46 | Repo Pattern | Ecto.Repo |
| 47 | Query Builder | Ecto.Query |
| 48 | Migrations | Ecto.Migration |
| 49 | Associations | Ecto associations + Repo.preload |
| 50 | PostgreSQL Adapter | Ecto.Adapters.Postgres |
| 51 | Transactions & Advanced | Ecto.Multi + aggregates + upserts |

[← Step 50: PostgreSQL Adapter](50-postgresql-adapter.md) | [Step 52: Ecto.Multi →](52-ecto-multi.md)

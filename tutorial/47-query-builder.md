[← Step 46: Repo Pattern](46-repo-pattern.md) | [Step 48: Migrations →](48-migrations.md)

# Step 47 — Query Builder

## What We're Building

A chainable query DSL that compiles to parameterized SQL — the Ember equivalent of Ecto.Query. Instead of writing raw SQL strings, you build queries fluently and the builder handles placeholders and parameter ordering.

## Concepts You'll Learn

- **Builder pattern** — fluent method chaining returning `this`
- **Parameterized queries** — all values use `?` placeholders (SQL injection safe)
- **SQL compilation** — separate `toSql()`, `toDeleteSql()`, `toCountSql()` outputs
- **Operator types** — typed union of supported SQL comparison operators
- **WHERE IN** — expand arrays into comma-separated placeholders

## How It Works

```
from("users")
  .select(["username", "email"])       ← columns (default: *)
  .distinct()                          ← optional DISTINCT
  .where("active", "=", true)          ← generic WHERE
  .whereEq("role", "admin")            ← shorthand for =
  .whereIn("id", [1, 2, 3])           ← WHERE id IN (?, ?, ?)
  .whereNull("deleted_at")            ← WHERE deleted_at IS NULL
  .whereLike("name", "%joe%")         ← WHERE name LIKE ?
  .groupBy("role")                     ← GROUP BY
  .having("count", ">", 5)            ← HAVING (with GROUP BY)
  .orderBy("username", "asc")         ← ORDER BY
  .limit(10).offset(20)               ← LIMIT / OFFSET

  .toSql()       → [sql, params]       ← SELECT query
  .toDeleteSql() → [sql, params]       ← DELETE query
  .toCountSql()  → [sql, params]       ← COUNT query
```

Each method returns `this`, so calls chain. `toSql()` walks the accumulated state and emits a parameterized SQL string with `?` placeholders and a matching `params` array.

## The Code

### `src/ember/query.ts` — Query class

```typescript
/**
 * Ember Query Builder — chainable query DSL compiling to parameterized SQL.
 *
 * Equivalent to Ecto.Query in Elixir.
 *
 * Usage:
 *   const q = from("users")
 *     .select(["username", "email"])
 *     .where("active", "=", true)
 *     .where("age", ">=", 18)
 *     .orderBy("username", "asc")
 *     .limit(10)
 *     .offset(20);
 *
 *   const [sql, params] = q.toSql();
 *   // → ["SELECT username, email FROM users WHERE active = ? AND age >= ? ORDER BY username ASC LIMIT 10 OFFSET 20", [true, 18]]
 */

export type Operator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "LIKE" | "IN" | "IS NULL" | "IS NOT NULL";
export type Direction = "ASC" | "DESC";

interface Condition {
  column: string;
  operator: Operator;
  value?: unknown;
}

interface OrderClause {
  column: string;
  direction: Direction;
}

export class Query {
  private table: string;
  private columns: string[] = ["*"];
  private conditions: Condition[] = [];
  private orders: OrderClause[] = [];
  private limitVal: number | null = null;
  private offsetVal: number | null = null;
  private groupByColumns: string[] = [];
  private havingConditions: Condition[] = [];
  private distinctFlag = false;

  constructor(table: string) {
    this.table = table;
  }

  /** Select specific columns. */
  select(cols: string[]): this {
    this.columns = cols;
    return this;
  }

  /** Add a DISTINCT modifier. */
  distinct(): this {
    this.distinctFlag = true;
    return this;
  }

  /** Add a WHERE condition. */
  where(column: string, operator: Operator, value?: unknown): this {
    this.conditions.push({ column, operator, value });
    return this;
  }

  /** Shorthand: where column = value. */
  whereEq(column: string, value: unknown): this {
    return this.where(column, "=", value);
  }

  /** WHERE column IN (...values). */
  whereIn(column: string, values: unknown[]): this {
    return this.where(column, "IN", values);
  }

  /** WHERE column IS NULL. */
  whereNull(column: string): this {
    return this.where(column, "IS NULL");
  }

  /** WHERE column IS NOT NULL. */
  whereNotNull(column: string): this {
    return this.where(column, "IS NOT NULL");
  }

  /** WHERE column LIKE pattern. */
  whereLike(column: string, pattern: string): this {
    return this.where(column, "LIKE", pattern);
  }

  /** Add ORDER BY clause. */
  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.orders.push({ column, direction: direction.toUpperCase() as Direction });
    return this;
  }

  /** Set LIMIT. */
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  /** Set OFFSET. */
  offset(n: number): this {
    this.offsetVal = n;
    return this;
  }

  /** Add GROUP BY columns. */
  groupBy(...cols: string[]): this {
    this.groupByColumns.push(...cols);
    return this;
  }

  /** Add a HAVING condition (used with GROUP BY). */
  having(column: string, operator: Operator, value?: unknown): this {
    this.havingConditions.push({ column, operator, value });
    return this;
  }

  /** Build SELECT SQL and params. */
  toSql(): [string, unknown[]] {
    const params: unknown[] = [];
    const dist = this.distinctFlag ? "DISTINCT " : "";
    let sql = `SELECT ${dist}${this.columns.join(", ")} FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += " WHERE " + this.buildConditions(this.conditions, params);
    }

    if (this.groupByColumns.length > 0) {
      sql += ` GROUP BY ${this.groupByColumns.join(", ")}`;
    }

    if (this.havingConditions.length > 0) {
      sql += " HAVING " + this.buildConditions(this.havingConditions, params);
    }

    if (this.orders.length > 0) {
      const orderParts = this.orders.map((o) => `${o.column} ${o.direction}`);
      sql += ` ORDER BY ${orderParts.join(", ")}`;
    }

    if (this.limitVal !== null) {
      sql += ` LIMIT ${this.limitVal}`;
    }

    if (this.offsetVal !== null) {
      sql += ` OFFSET ${this.offsetVal}`;
    }

    return [sql, params];
  }

  /** Build DELETE SQL and params. */
  toDeleteSql(): [string, unknown[]] {
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += " WHERE " + this.buildConditions(this.conditions, params);
    }

    return [sql, params];
  }

  /** Build COUNT SQL and params. */
  toCountSql(): [string, unknown[]] {
    const params: unknown[] = [];
    let sql = `SELECT COUNT(*) as count FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += " WHERE " + this.buildConditions(this.conditions, params);
    }

    if (this.groupByColumns.length > 0) {
      sql += ` GROUP BY ${this.groupByColumns.join(", ")}`;
    }

    if (this.havingConditions.length > 0) {
      sql += " HAVING " + this.buildConditions(this.havingConditions, params);
    }

    return [sql, params];
  }

  private buildConditions(conditions: Condition[], params: unknown[]): string {
    return conditions
      .map((c) => {
        switch (c.operator) {
          case "IS NULL":
            return `${c.column} IS NULL`;
          case "IS NOT NULL":
            return `${c.column} IS NOT NULL`;
          case "IN": {
            const arr = c.value as unknown[];
            const placeholders = arr.map(() => "?").join(", ");
            params.push(...arr);
            return `${c.column} IN (${placeholders})`;
          }
          default:
            params.push(c.value);
            return `${c.column} ${c.operator} ?`;
        }
      })
      .join(" AND ");
  }
}

/** Create a new query for a table. */
export function from(table: string): Query {
  return new Query(table);
}
```

There are a few things to notice:

**Type-safe operators.** The `Operator` union limits what can appear in a WHERE clause. TypeScript will reject `where("age", "BETWEEN", 18)` at compile time because `"BETWEEN"` is not in the union.

**`buildConditions` is shared.** Both WHERE and HAVING clauses use the same condition-building logic. The `params` array is passed by reference and mutated in place, so the final `[sql, params]` tuple always has placeholders and values in the correct order.

**IN expansion.** When the operator is `"IN"`, the value is an array. The builder generates one `?` per element and spreads the values into the params array:

```typescript
case "IN": {
  const arr = c.value as unknown[];
  const placeholders = arr.map(() => "?").join(", ");
  params.push(...arr);
  return `${c.column} IN (${placeholders})`;
}
```

So `whereIn("id", [1, 2, 3])` produces `id IN (?, ?, ?)` with params `[1, 2, 3]`.

**IS NULL / IS NOT NULL need no value.** These operators emit literal SQL with no placeholder — the value field is unused.

**Three output modes.** The same accumulated state can produce three different SQL statements:

- `toSql()` — `SELECT columns FROM table WHERE ... ORDER BY ... LIMIT ... OFFSET ...`
- `toDeleteSql()` — `DELETE FROM table WHERE ...` (ignores select/order/limit)
- `toCountSql()` — `SELECT COUNT(*) as count FROM table WHERE ... GROUP BY ... HAVING ...`

### `src/ember/repo.ts` — Added `query()` and `execute()`

Two methods were added to the Repo class to bridge the query builder with the database:

```typescript
/** Execute raw SQL query (SELECT). */
query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return this.adapter.all<T>(sql, params);
}

/** Execute raw SQL statement (INSERT/UPDATE/DELETE). */
execute(sql: string, params: unknown[] = []) {
  return this.adapter.run(sql, params);
}
```

These let you run query builder output directly:

```typescript
import { from } from "./ember/query.js";

// Build the query
const q = from("users")
  .select(["username", "email"])
  .where("active", "=", true)
  .orderBy("username")
  .limit(10);

// Execute via Repo
const [sql, params] = q.toSql();
const users = repo.query(sql, params);

// Delete via Repo
const dq = from("sessions").where("expired_at", "<", "2024-01-01");
const [delSql, delParams] = dq.toDeleteSql();
repo.execute(delSql, delParams);
```

## Try It Out

```bash
npm test
```

18 query tests pass — 14 SQL generation tests + 4 Repo integration tests.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/query.ts` | **New** | Chainable query builder with SQL compilation |
| `src/ember/repo.ts` | **Modified** | Added `query()` and `execute()` for running raw SQL |
| `test/query.test.ts` | **New** | 18 tests for SQL generation + Repo integration |

## What's Next

**Step 48 — Migrations:** `defineMigration()`, `schema_migrations` tracking table, and `npm run migrate` CLI.

[← Step 46: Repo Pattern](46-repo-pattern.md) | [Step 48: Migrations →](48-migrations.md)

[← Step 53: Aggregate Queries](53-aggregate-queries.md) | [Step 55: Seeds →](55-seeds.md)

# Step 54 — Pagination

## What We're Building

Offset-based pagination for Ember ORM — both simple schema-level pagination and query builder integration. Returns `{ data, page, perPage, total, totalPages }` like typical REST APIs.

## Concepts You'll Learn

- **Offset pagination** — LIMIT/OFFSET with total count
- **Page metadata** — total records, total pages, current page
- **Query builder integration** — paginate any chainable query
- **Two-query pattern** — one COUNT query + one data query per page

## How It Works

```
paginate(repo, UserSchema, { page: 2, perPage: 10 })
  → SELECT COUNT(*) as count FROM users          // 1 query for total
  → SELECT * FROM users LIMIT 10 OFFSET 10       // 1 query for data
  → { data: [...], page: 2, perPage: 10, total: 42, totalPages: 5 }
```

## The Code

### `src/ember/pagination.ts`

```typescript
/**
 * Ember Pagination — cursor and offset-based pagination helpers.
 *
 * Usage:
 *   const page = repo.paginate(UserSchema, { page: 2, perPage: 10 });
 *   // → { data: [...], page: 2, perPage: 10, total: 42, totalPages: 5 }
 *
 *   // With query builder:
 *   const q = from("users").where("active", "=", true).orderBy("username");
 *   const page = paginateQuery(repo, q, { page: 1, perPage: 20 });
 */

import type { Schema } from "./schema.js";
import type { Repo } from "./repo.js";
import type { Query } from "./query.js";

export interface PaginateOptions {
  page?: number;
  perPage?: number;
}

export interface Page<T> {
  data: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/**
 * Paginate a schema's table with optional conditions.
 */
export function paginate<T>(
  repo: Repo,
  schema: Schema,
  options: PaginateOptions & { conditions?: Record<string, unknown> } = {},
): Page<T> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.max(1, options.perPage ?? 20);
  const offset = (page - 1) * perPage;

  const conditions = options.conditions ?? {};
  const keys = Object.keys(conditions);
  const params: unknown[] = keys.map((k) => conditions[k]);

  let whereSql = "";
  if (keys.length > 0) {
    whereSql = " WHERE " + keys.map((k) => `${k} = ?`).join(" AND ");
  }

  const countRow = repo.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM ${schema.tableName}${whereSql}`,
    params,
  );
  const total = countRow[0]?.count ?? 0;

  const data = repo.query<T>(
    `SELECT * FROM ${schema.tableName}${whereSql} LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return {
    data,
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}

/**
 * Paginate using a Query builder instance.
 * The query's existing LIMIT/OFFSET will be overridden.
 */
export function paginateQuery<T>(
  repo: Repo,
  query: Query,
  options: PaginateOptions = {},
): Page<T> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.max(1, options.perPage ?? 20);

  // Get count
  const [countSql, countParams] = query.toCountSql();
  const countRow = repo.query<{ count: number }>(countSql, countParams);
  const total = countRow[0]?.count ?? 0;

  // Get paginated data
  const paginatedQuery = Object.create(Object.getPrototypeOf(query));
  Object.assign(paginatedQuery, query);
  paginatedQuery.limit(perPage).offset((page - 1) * perPage);
  const [dataSql, dataParams] = paginatedQuery.toSql();
  const data = repo.query<T>(dataSql, dataParams);

  return {
    data,
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}
```

### Key Design Decisions

**Two functions for two use cases:**

1. **`paginate()`** takes a schema and optional `conditions` object. It builds simple `WHERE key = ?` clauses internally. Best for straightforward table scans with equality filters.

2. **`paginateQuery()`** takes an existing `Query` builder instance with arbitrary WHERE, ORDER BY, and JOIN clauses already applied. It clones the query (via `Object.create` + `Object.assign`) to avoid mutating the original, then overrides LIMIT/OFFSET.

**Page normalization:** Both functions clamp `page` and `perPage` to a minimum of 1 using `Math.max(1, ...)`, so passing `page: 0` or `perPage: -5` won't produce invalid SQL.

**Total pages calculation:** `Math.ceil(total / perPage)` ensures partial last pages are counted. If total is 0, totalPages is 0.

### Usage Examples

**Simple pagination:**

```typescript
const page = paginate(repo, UserSchema, {
  page: 2,
  perPage: 10,
  conditions: { active: true },
});
// page.data       → 10 user records
// page.total      → 38
// page.totalPages → 4
```

**Query builder pagination:**

```typescript
const q = from("users")
  .whereEq("active", true)
  .orderBy("username");

const page = paginateQuery(repo, q, { page: 1, perPage: 20 });
```

### Page Interface

```typescript
interface Page<T> {
  data: T[];        // records for this page
  page: number;     // current page (1-based)
  perPage: number;  // items per page
  total: number;    // total record count
  totalPages: number; // ceil(total / perPage)
}
```

## Try It Out

```bash
npm test
```

9 pagination tests pass covering defaults, specific pages, edge cases, conditions, and query builder integration.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/pagination.ts` | **New** | `paginate()` and `paginateQuery()` helpers |
| `test/pagination.test.ts` | **New** | 9 tests for pagination |

## What's Next

**Step 55 — Seeds:** `npm run seed` script pattern for populating initial/test data.

[← Step 53: Aggregate Queries](53-aggregate-queries.md) | [Step 55: Seeds →](55-seeds.md)

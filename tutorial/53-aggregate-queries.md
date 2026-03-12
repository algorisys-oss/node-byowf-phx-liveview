[← Step 52: Ecto.Multi](52-ecto-multi.md) | [Step 54: Pagination →](54-pagination.md)

# Step 53 — Aggregate Queries

> **Note:** This feature was implemented across [Step 47 — Query Builder](47-query-builder.md) (GROUP BY, HAVING) and [Step 51 — Transactions & Advanced](51-transactions-advanced.md) (count/sum/avg/min/max). This tutorial provides a focused reference.

## What We're Building

Aggregate functions in two forms: the Query Builder's `groupBy()`/`having()` for complex aggregations, and Repo's `aggregate()` for simple one-liners.

## The Code

### Query Builder — GROUP BY / HAVING

See [src/ember/query.ts](../src/ember/query.ts).

```typescript
import { from } from "./ember/query.js";

const [sql, params] = from("orders")
  .select(["user_id", "COUNT(*) as total"])
  .groupBy("user_id")
  .having("COUNT(*)", ">", 5)
  .toSql();
// → SELECT user_id, COUNT(*) as total FROM orders GROUP BY user_id HAVING COUNT(*) > ?

const [countSql, countParams] = from("users")
  .where("active", "=", true)
  .toCountSql();
// → SELECT COUNT(*) as count FROM users WHERE active = ?
```

### Repo — Simple Aggregates

See [src/ember/repo.ts](../src/ember/repo.ts).

```typescript
repo.aggregate(UserSchema, "count");                          // 42
repo.aggregate(UserSchema, "sum", "age");                     // 1260
repo.aggregate(UserSchema, "avg", "age");                     // 30
repo.aggregate(UserSchema, "min", "age");                     // 18
repo.aggregate(UserSchema, "max", "age");                     // 65
repo.aggregate(UserSchema, "count", "*", { active: true });   // with conditions
```

### Tests

- 18 query builder tests in `test/query.test.ts` (including GROUP BY, HAVING, COUNT)
- 5 aggregate tests in `test/transactions.test.ts`

[← Step 52: Ecto.Multi](52-ecto-multi.md) | [Step 54: Pagination →](54-pagination.md)

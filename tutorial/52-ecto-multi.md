[← Step 51: Transactions & Advanced](51-transactions-advanced.md) | [Step 53: Aggregate Queries →](53-aggregate-queries.md)

# Step 52 — Ecto.Multi

> **Note:** This feature was implemented as part of [Step 51 — Transactions & Advanced](51-transactions-advanced.md). This tutorial provides a focused reference.

## What We're Building

Composable multi-operation transactions. Chain insert/update/delete/run steps, then execute them atomically — if any step fails, everything rolls back.

## The Code

See [src/ember/multi.ts](../src/ember/multi.ts).

```typescript
import { multi } from "./ember/multi.js";

const result = multi()
  .insert("user", UserSchema, userChangeset)
  .insert("post", PostSchema, postChangeset)
  .run("notify", (results) => sendEmail(results.user))
  .deleteStep("old", OldSchema, oldId)
  .execute(repo);

if (result.ok) {
  result.results.user   // inserted user record
  result.results.post   // inserted post record
  result.results.notify // return value from custom function
} else {
  result.failed  // name of failed step
  result.error   // failed changeset or error value
  // all previous operations have been rolled back
}
```

### Available Steps

| Method | Description |
|--------|-------------|
| `.insert(name, schema, changeset)` | Insert via Repo, fail if changeset invalid |
| `.update(name, schema, changeset)` | Update via Repo, fail if changeset invalid |
| `.deleteStep(name, schema, id)` | Delete by ID, fail if not found |
| `.run(name, fn)` | Custom function, receives all prior results |

### Tests

13 tests in `test/transactions.test.ts` covering Multi, transactions, aggregates, and upserts.

[← Step 51: Transactions & Advanced](51-transactions-advanced.md) | [Step 53: Aggregate Queries →](53-aggregate-queries.md)

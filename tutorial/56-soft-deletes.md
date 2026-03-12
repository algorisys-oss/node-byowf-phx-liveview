[← Step 55: Seeds](55-seeds.md) | [Step 57: Virtual Fields →](57-virtual-fields.md)

# Step 56 — Soft Deletes

## What We're Building

Soft-delete support for Ember ORM. Instead of permanently removing records, set a `deleted_at` timestamp. Queries automatically filter out deleted records, with `withTrashed()` to include them and `purgeTrashed()` for permanent removal.

## Concepts You'll Learn

- **Soft deletes** — mark as deleted instead of removing from database
- **Query filtering** — `allActive()` excludes deleted, `allTrashed()` finds deleted
- **Restore** — undo a soft delete by clearing `deleted_at`
- **Purge** — permanently remove soft-deleted records

## How It Works

```
softDelete(repo, schema, id)   → UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
restore(repo, schema, id)      → UPDATE users SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL
allActive(repo, schema)        → SELECT * FROM users WHERE deleted_at IS NULL
allTrashed(repo, schema)       → SELECT * FROM users WHERE deleted_at IS NOT NULL
withTrashed(repo, schema)      → SELECT * FROM users (no filter)
getActive(repo, schema, id)    → SELECT * WHERE id = ? AND deleted_at IS NULL
purgeTrashed(repo, schema)     → DELETE FROM users WHERE deleted_at IS NOT NULL
```

## The Code

### `src/ember/soft_delete.ts`

```typescript
/**
 * Ember Soft Deletes — mark records as deleted instead of removing them.
 *
 * Adds `deleted_at` timestamp support. Provides filtered queries that
 * automatically exclude soft-deleted records, with `withTrashed()` to
 * include them.
 *
 * Usage:
 *   softDelete(repo, UserSchema, userId);     // sets deleted_at
 *   restore(repo, UserSchema, userId);         // clears deleted_at
 *   allActive(repo, UserSchema);               // WHERE deleted_at IS NULL
 *   allTrashed(repo, UserSchema);              // WHERE deleted_at IS NOT NULL
 *   withTrashed(repo, UserSchema);             // all records, no filter
 */

import type { Schema } from "./schema.js";
import type { Repo } from "./repo.js";

/**
 * Soft-delete a record by setting deleted_at to current timestamp.
 */
export function softDelete(repo: Repo, schema: Schema, id: unknown): boolean {
  const now = new Date().toISOString();
  const result = repo.execute(
    `UPDATE ${schema.tableName} SET deleted_at = ? WHERE ${schema.primaryKey} = ? AND deleted_at IS NULL`,
    [now, id],
  );
  return result.changes > 0;
}

/**
 * Restore a soft-deleted record by clearing deleted_at.
 */
export function restore(repo: Repo, schema: Schema, id: unknown): boolean {
  const result = repo.execute(
    `UPDATE ${schema.tableName} SET deleted_at = NULL WHERE ${schema.primaryKey} = ? AND deleted_at IS NOT NULL`,
    [id],
  );
  return result.changes > 0;
}

/**
 * Get all active (non-deleted) records.
 */
export function allActive<T>(repo: Repo, schema: Schema): T[] {
  return repo.query<T>(
    `SELECT * FROM ${schema.tableName} WHERE deleted_at IS NULL`,
  );
}

/**
 * Get all soft-deleted (trashed) records.
 */
export function allTrashed<T>(repo: Repo, schema: Schema): T[] {
  return repo.query<T>(
    `SELECT * FROM ${schema.tableName} WHERE deleted_at IS NOT NULL`,
  );
}

/**
 * Get all records including soft-deleted ones.
 */
export function withTrashed<T>(repo: Repo, schema: Schema): T[] {
  return repo.all<T>(schema);
}

/**
 * Get a single active record by ID (returns null if soft-deleted).
 */
export function getActive<T>(repo: Repo, schema: Schema, id: unknown): T | null {
  return repo.query<T>(
    `SELECT * FROM ${schema.tableName} WHERE ${schema.primaryKey} = ? AND deleted_at IS NULL`,
    [id],
  )[0] ?? null;
}

/**
 * Permanently delete all soft-deleted records (purge).
 */
export function purgeTrashed(repo: Repo, schema: Schema): number {
  const result = repo.execute(
    `DELETE FROM ${schema.tableName} WHERE deleted_at IS NOT NULL`,
  );
  return result.changes;
}
```

### Key Design Decisions

**Idempotent operations:** `softDelete()` includes `AND deleted_at IS NULL` so soft-deleting an already-deleted record returns `false` (no change). Similarly, `restore()` includes `AND deleted_at IS NOT NULL` so restoring an active record is a no-op.

**ISO timestamps:** `deleted_at` stores a full ISO 8601 string (`2026-03-10T15:30:00.000Z`), providing both the fact that the record is deleted and exactly when it was deleted.

**Table requirement:** Your table must have a `deleted_at TEXT` column. Add it in a migration:

```typescript
const addSoftDelete = defineMigration({
  up(m) {
    m.addColumn("users", "deleted_at", "TEXT");
  },
  down(m) {
    m.dropColumn("users", "deleted_at");
  },
});
```

**No automatic filtering:** Unlike some ORMs that implicitly filter deleted records on every query, Ember keeps it explicit. You choose `allActive()` vs `withTrashed()` at the call site. This avoids hidden behavior and makes the filtering visible in code.

### Usage Example

```typescript
import { softDelete, restore, allActive, allTrashed, purgeTrashed } from "./ember/soft_delete.js";

// Soft-delete a user
softDelete(repo, UserSchema, 42);  // → true

// They no longer appear in active queries
allActive(repo, UserSchema);       // → excludes user 42
allTrashed(repo, UserSchema);      // → includes user 42

// Oops, undo that
restore(repo, UserSchema, 42);     // → true

// Permanently remove all trashed records
const purged = purgeTrashed(repo, UserSchema);
console.log(`Purged ${purged} records`);
```

## Try It Out

```bash
npm test
```

9 soft-delete tests pass covering delete, restore, filtering, getActive, and purge.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/soft_delete.ts` | **New** | Soft delete operations |
| `test/soft-delete.test.ts` | **New** | 9 tests for soft deletes |

## What's Next

**Step 57 — Virtual Fields:** Computed schema fields that don't map to database columns.

[← Step 55: Seeds](55-seeds.md) | [Step 57: Virtual Fields →](57-virtual-fields.md)

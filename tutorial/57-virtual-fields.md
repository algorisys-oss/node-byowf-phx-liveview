[← Step 56: Soft Deletes](56-soft-deletes.md) | [Step 58: Todo App →](58-todo-app.md)

# Step 57 — Virtual Fields

## What We're Building

Computed schema fields that don't map to database columns. Virtual fields are calculated from other fields after records are loaded — fullName from firstName + lastName, isAdult from age, etc.

## Concepts You'll Learn

- **Virtual/computed fields** — derive values from persisted data
- **Post-load transformation** — apply virtuals after DB fetch
- **Immutability** — original records are not mutated (spread operator creates new objects)

## How It Works

```
defineVirtuals<User>({ fullName: (u) => ... })
  → stores compute functions in a plain object

applyVirtual(record, virtuals)
  → { ...record }                     // shallow copy
  → for each virtual: result[key] = fn(record)
  → returns enriched copy

applyVirtuals(records, virtuals)
  → records.map(r => applyVirtual(r, virtuals))
```

The original record objects are never mutated. Each call returns a new object with virtual fields added alongside the database fields.

## The Code

### `src/ember/virtual.ts`

```typescript
/**
 * Ember Virtual Fields — computed fields that don't map to database columns.
 *
 * Virtual fields are calculated from other fields on the record.
 * They're applied after records are loaded from the database.
 *
 * Usage:
 *   const virtuals = defineVirtuals<User>({
 *     fullName: (u) => `${u.firstName} ${u.lastName}`,
 *     isAdult: (u) => u.age >= 18,
 *     initials: (u) => `${u.firstName[0]}${u.lastName[0]}`.toUpperCase(),
 *   });
 *
 *   const users = repo.all(UserSchema);
 *   const enriched = applyVirtuals(users, virtuals);
 *   // enriched[0].fullName → "Alice Smith"
 */

/** Virtual field definition: a function that computes a value from a record. */
export type VirtualDef<T, V = unknown> = (record: T) => V;

/** Map of virtual field names to their compute functions. */
export type VirtualMap<T> = Record<string, VirtualDef<T>>;

/**
 * Define virtual fields for a record type.
 */
export function defineVirtuals<T>(virtuals: VirtualMap<T>): VirtualMap<T> {
  return virtuals;
}

/**
 * Apply virtual fields to a single record.
 * Returns a new object with virtual fields added.
 */
export function applyVirtual<T extends Record<string, unknown>>(
  record: T,
  virtuals: VirtualMap<T>,
): T & Record<string, unknown> {
  const result = { ...record };
  for (const [key, fn] of Object.entries(virtuals)) {
    (result as any)[key] = fn(record);
  }
  return result;
}

/**
 * Apply virtual fields to an array of records.
 * Returns new objects with virtual fields added.
 */
export function applyVirtuals<T extends Record<string, unknown>>(
  records: T[],
  virtuals: VirtualMap<T>,
): (T & Record<string, unknown>)[] {
  return records.map((r) => applyVirtual(r, virtuals));
}
```

### Key Design Decisions

**`defineVirtuals()` is an identity function.** It simply returns the object you pass in. Its purpose is type safety — it constrains the compute functions to receive `T` and lets the type checker verify your virtual field logic at compile time.

**Immutability via spread:** `applyVirtual()` creates a shallow copy with `{ ...record }` before adding virtual fields. The original database record is never modified. This is important when the same record might be used in multiple places with different virtual field sets.

**Compute from original:** Virtual field functions receive the original `record`, not the copy. This means one virtual field cannot depend on another virtual field — they all compute from the raw database data. This avoids ordering dependencies between virtuals.

**Generics:** The `T extends Record<string, unknown>` constraint ensures virtual fields work with any plain object, not just specific schema types.

### Usage Example

```typescript
import { defineVirtuals, applyVirtuals, applyVirtual } from "./ember/virtual.js";

interface User {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
}

const userVirtuals = defineVirtuals<User>({
  fullName: (u) => `${u.firstName} ${u.lastName}`,
  isAdult: (u) => u.age >= 18,
  initials: (u) => `${u.firstName[0]}${u.lastName[0]}`.toUpperCase(),
  domain: (u) => u.email.split("@")[1],
});

// Apply to a single record
const user = repo.get<User>(UserSchema, 1);
const enriched = applyVirtual(user, userVirtuals);
// enriched.fullName  → "Alice Smith"
// enriched.isAdult   → true
// enriched.initials  → "AS"
// enriched.domain    → "example.com"

// Apply to an array
const users = repo.all<User>(UserSchema);
const allEnriched = applyVirtuals(users, userVirtuals);
```

## Try It Out

```bash
npm test
```

7 virtual field tests pass covering single/array application, immutability, and edge cases.

## Module 10 Complete!

The Ember ORM Extras module adds:

| Step | Feature |
|------|---------|
| 52 | Ecto.Multi (composable atomic transactions) |
| 53 | Aggregate Queries (GROUP BY, HAVING, count/sum/avg) |
| 54 | Pagination (offset-based with total count) |
| 55 | Seeds (transactional database seeding) |
| 56 | Soft Deletes (deleted_at with filter/restore/purge) |
| 57 | Virtual Fields (computed non-DB fields) |

## What's Next

**Step 58 — Todo App:** Full CRUD LiveView application using Ember ORM, demonstrating all framework features together.

[← Step 56: Soft Deletes](56-soft-deletes.md) | [Step 58: Todo App →](58-todo-app.md)

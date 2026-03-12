[← Step 43: Single Executable](43-single-executable.md) | [Step 45: SQLite Adapter →](45-sqlite-adapter.md)

# Step 44 — Schema & Changeset

## What We're Building

The foundation of the **Ember ORM** (our Ecto equivalent): `defineSchema()` for mapping TypeScript types to database tables, and `changeset()` for validating and tracking changes before persisting.

These two modules are the heart of Ember. Every database operation in later steps will use schemas to know table structure and changesets to validate data before it reaches the database.

## Concepts You'll Learn

- **Schema definition** — declaring table name, field types, timestamps, and associations
- **Changesets** — mutable change tracking with validation pipeline
- **Cast & validate** — whitelist allowed fields, then run validators
- **Constraint metadata** — unique constraints checked at persistence time (by the Repo)
- **Association declarations** — `hasMany`, `belongsTo`, `hasOne` for relationship metadata

## How It Works

### Schema

A schema maps a TypeScript type to a database table:

```typescript
const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string", nullable: true },
  active: { type: "boolean", default: true },
});
// → { tableName: "users", fields: {...}, primaryKey: "id", timestamps: true }
```

Timestamps (`inserted_at`, `updated_at`) are enabled by default. The primary key defaults to `"id"`.

### Changeset Pipeline

Changesets are created by casting form data through a whitelist of allowed fields, then piped through validators:

```typescript
let cs = changeset(user, formData, ["username", "email"]);
cs = validateRequired(cs, ["username", "email"]);
cs = validateLength(cs, "username", { min: 2, max: 50 });
cs = validateFormat(cs, "email", /@/);
cs = uniqueConstraint(cs, "email");  // checked later by Repo

cs.valid   // true or false
cs.changes // { username: "Alice", email: "a@b.com" }
cs.errors  // { email: ["has invalid format"] }
```

Each validator returns the changeset (mutated), so you can chain them. If any validation fails, `cs.valid` becomes `false` and error messages accumulate in `cs.errors`.

## The Code

### `src/ember/schema.ts` — Schema definition

This module defines the schema structure, field types, and association helpers:

```typescript
/**
 * Ember Schema -- Define typed database schemas.
 *
 * Equivalent to Ecto.Schema in Elixir.
 * Maps TypeScript types to database table columns with field definitions.
 */

export type FieldType = "string" | "integer" | "boolean" | "datetime" | "text" | "float";

export interface FieldDef {
  type: FieldType;
  default?: unknown;
  nullable?: boolean;
}

export interface AssociationDef {
  type: "hasMany" | "belongsTo" | "hasOne";
  schema: () => Schema;
  foreignKey: string;
}

export interface Schema {
  tableName: string;
  fields: Record<string, FieldDef>;
  primaryKey: string;
  timestamps: boolean;
  associations: Record<string, AssociationDef>;
}

export interface SchemaOptions {
  timestamps?: boolean;
  primaryKey?: string;
  associations?: Record<string, AssociationDef>;
}

/**
 * Define a database schema.
 *
 * Usage:
 *   const UserSchema = defineSchema("users", {
 *     username: { type: "string" },
 *     email: { type: "string", nullable: true },
 *     active: { type: "boolean", default: true },
 *   });
 */
export function defineSchema(
  tableName: string,
  fields: Record<string, FieldDef>,
  options: SchemaOptions = {},
): Schema {
  return {
    tableName,
    fields,
    primaryKey: options.primaryKey ?? "id",
    timestamps: options.timestamps !== false,
    associations: options.associations ?? {},
  };
}

/**
 * Get all field names (including id and timestamps if enabled).
 */
export function allFields(schema: Schema): string[] {
  const fields = [schema.primaryKey, ...Object.keys(schema.fields)];
  if (schema.timestamps) {
    fields.push("inserted_at", "updated_at");
  }
  return fields;
}

/**
 * Get insertable field names (excludes primary key).
 */
export function insertableFields(schema: Schema): string[] {
  const fields = Object.keys(schema.fields);
  if (schema.timestamps) {
    fields.push("inserted_at", "updated_at");
  }
  return fields;
}

/**
 * Declare a hasMany association.
 * The foreign key lives on the related table.
 *
 * Usage:
 *   const UserSchema = defineSchema("users", { ... }, {
 *     associations: {
 *       posts: hasMany(() => PostSchema, "user_id"),
 *     },
 *   });
 */
export function hasMany(schema: () => Schema, foreignKey: string): AssociationDef {
  return { type: "hasMany", schema, foreignKey };
}

/**
 * Declare a belongsTo association.
 * The foreign key lives on this table.
 *
 * Usage:
 *   const PostSchema = defineSchema("posts", {
 *     user_id: { type: "integer" },
 *     title: { type: "string" },
 *   }, {
 *     associations: {
 *       user: belongsTo(() => UserSchema, "user_id"),
 *     },
 *   });
 */
export function belongsTo(schema: () => Schema, foreignKey: string): AssociationDef {
  return { type: "belongsTo", schema, foreignKey };
}

/**
 * Declare a hasOne association.
 * The foreign key lives on the related table.
 */
export function hasOne(schema: () => Schema, foreignKey: string): AssociationDef {
  return { type: "hasOne", schema, foreignKey };
}
```

Key design decisions:

- **`FieldType`** covers the most common SQL column types. More can be added later.
- **`SchemaOptions`** lets you override the primary key name, disable timestamps, or declare associations.
- **`allFields()`** and **`insertableFields()`** are utility functions used by the Repo to build SQL queries -- `insertableFields` excludes the primary key since the database auto-generates it.
- **Association functions** use thunks (`() => Schema`) to avoid circular import issues when two schemas reference each other.

### `src/ember/changeset.ts` — Changeset with validators

The changeset module provides change tracking and a full validation toolkit:

```typescript
/**
 * Ember Changeset -- Validate and track changes to data.
 *
 * Equivalent to Ecto.Changeset in Elixir.
 * A changeset holds the original data, proposed changes, and validation errors.
 * Only valid changesets can be persisted by the Repo.
 */

export interface Changeset<T = Record<string, unknown>> {
  valid: boolean;
  data: T;
  changes: Partial<T>;
  errors: Record<string, string[]>;
  constraints: Constraint[];
  action?: "insert" | "update" | "delete";
}

interface Constraint {
  type: "unique";
  field: string;
  message?: string;
}

/**
 * Create a changeset by casting attributes through allowed fields.
 * Only fields in `allowed` are accepted from `attrs`.
 *
 * Usage:
 *   const cs = changeset(user, formData, ["username", "email"]);
 */
export function changeset<T extends Record<string, unknown>>(
  data: T,
  attrs: Record<string, unknown>,
  allowed: string[],
): Changeset<T> {
  const changes: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in attrs && attrs[key] !== (data as Record<string, unknown>)[key]) {
      changes[key] = attrs[key];
    }
  }
  return {
    valid: true,
    data,
    changes: changes as Partial<T>,
    errors: {},
    constraints: [],
  };
}
```

The `changeset()` function is the entry point. It takes the original data (could be an empty object for new records), the incoming attributes (e.g., from a form submission), and a whitelist of allowed field names. Only attributes that are both in the whitelist AND different from the current data become "changes".

Next, the internal helpers used by all validators:

```typescript
/** Add an error to a changeset field. */
function addError<T>(cs: Changeset<T>, field: string, message: string): void {
  if (!cs.errors[field]) cs.errors[field] = [];
  cs.errors[field].push(message);
  cs.valid = false;
}

/** Get the effective value of a field (change or original data). */
function getField<T>(cs: Changeset<T>, field: string): unknown {
  if (field in cs.changes) return (cs.changes as Record<string, unknown>)[field];
  return (cs.data as Record<string, unknown>)[field];
}
```

`getField` checks the changes first, then falls back to the original data. This is important -- if a field was not changed, validators still check the original value.

Now the validators. Each one takes a changeset, performs a check, and returns the same changeset (possibly with new errors):

```typescript
// ── Validators ──

/**
 * Validate that required fields are present (in changes or data).
 */
export function validateRequired<T>(cs: Changeset<T>, fields: string[]): Changeset<T> {
  for (const field of fields) {
    const value = getField(cs, field);
    if (value === undefined || value === null || value === "") {
      addError(cs, field, "can't be blank");
    }
  }
  return cs;
}

/**
 * Validate string length.
 */
export function validateLength<T>(
  cs: Changeset<T>,
  field: string,
  opts: { min?: number; max?: number; is?: number },
): Changeset<T> {
  const value = getField(cs, field);
  if (value === undefined || value === null) return cs;
  const len = String(value).length;

  if (opts.is !== undefined && len !== opts.is) {
    addError(cs, field, `should be ${opts.is} character(s)`);
  }
  if (opts.min !== undefined && len < opts.min) {
    addError(cs, field, `should be at least ${opts.min} character(s)`);
  }
  if (opts.max !== undefined && len > opts.max) {
    addError(cs, field, `should be at most ${opts.max} character(s)`);
  }
  return cs;
}

/**
 * Validate field matches a regex pattern.
 */
export function validateFormat<T>(
  cs: Changeset<T>,
  field: string,
  pattern: RegExp,
  message: string = "has invalid format",
): Changeset<T> {
  const value = getField(cs, field);
  if (value === undefined || value === null) return cs;
  if (!pattern.test(String(value))) {
    addError(cs, field, message);
  }
  return cs;
}

/**
 * Validate field value is in a list of allowed values.
 */
export function validateInclusion<T>(
  cs: Changeset<T>,
  field: string,
  values: unknown[],
  message: string = "is invalid",
): Changeset<T> {
  const value = getField(cs, field);
  if (value === undefined || value === null) return cs;
  if (!values.includes(value)) {
    addError(cs, field, message);
  }
  return cs;
}

/**
 * Validate numeric constraints.
 */
export function validateNumber<T>(
  cs: Changeset<T>,
  field: string,
  opts: { greaterThan?: number; lessThan?: number; greaterThanOrEqual?: number; lessThanOrEqual?: number },
): Changeset<T> {
  const value = getField(cs, field);
  if (value === undefined || value === null) return cs;
  const num = Number(value);

  if (opts.greaterThan !== undefined && num <= opts.greaterThan) {
    addError(cs, field, `must be greater than ${opts.greaterThan}`);
  }
  if (opts.lessThan !== undefined && num >= opts.lessThan) {
    addError(cs, field, `must be less than ${opts.lessThan}`);
  }
  if (opts.greaterThanOrEqual !== undefined && num < opts.greaterThanOrEqual) {
    addError(cs, field, `must be greater than or equal to ${opts.greaterThanOrEqual}`);
  }
  if (opts.lessThanOrEqual !== undefined && num > opts.lessThanOrEqual) {
    addError(cs, field, `must be less than or equal to ${opts.lessThanOrEqual}`);
  }
  return cs;
}

/**
 * Custom validation function.
 */
export function validate<T>(
  cs: Changeset<T>,
  field: string,
  fn: (value: unknown) => string | null,
): Changeset<T> {
  const value = getField(cs, field);
  const error = fn(value);
  if (error) addError(cs, field, error);
  return cs;
}

/**
 * Mark a unique constraint to be checked by the Repo on insert/update.
 */
export function uniqueConstraint<T>(
  cs: Changeset<T>,
  field: string,
  message: string = "has already been taken",
): Changeset<T> {
  cs.constraints.push({ type: "unique", field, message });
  return cs;
}

/**
 * Put a change directly (bypass casting).
 */
export function putChange<T>(
  cs: Changeset<T>,
  field: string,
  value: unknown,
): Changeset<T> {
  (cs.changes as Record<string, unknown>)[field] = value;
  return cs;
}

/**
 * Get a change value.
 */
export function getChange<T>(cs: Changeset<T>, field: string): unknown {
  return (cs.changes as Record<string, unknown>)[field];
}

/**
 * Apply changes to data (merge changes into data). Does NOT persist.
 */
export function applyChanges<T>(cs: Changeset<T>): T {
  return { ...cs.data, ...cs.changes };
}
```

Here is a summary of all the validators:

| Validator | Purpose |
|-----------|---------|
| `validateRequired(cs, fields)` | Ensures fields are not `undefined`, `null`, or `""` |
| `validateLength(cs, field, { min, max, is })` | Checks string length bounds |
| `validateFormat(cs, field, regex)` | Tests field value against a regex |
| `validateInclusion(cs, field, values)` | Field must be one of the allowed values |
| `validateNumber(cs, field, { greaterThan, lessThan, ... })` | Numeric range checks |
| `validate(cs, field, fn)` | Custom validator -- return a string for error, null for pass |
| `uniqueConstraint(cs, field)` | Registers a constraint for the Repo to check at insert/update time |
| `putChange(cs, field, value)` | Directly inject a change (e.g., hashed password) |
| `getChange(cs, field)` | Read a change value |
| `applyChanges(cs)` | Merge changes into data without persisting |

Notice that `uniqueConstraint` does NOT check the database -- it only records metadata. The actual uniqueness check happens in `Repo.insert()` / `Repo.update()` (Step 46), which queries the database for existing records.

## Try It Out

```bash
npm test
```

15 changeset tests pass covering all validators.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/schema.ts` | **New** | `defineSchema()`, field types, association helpers |
| `src/ember/changeset.ts` | **New** | Changeset creation, 10 validators, constraint metadata |
| `test/changeset.test.ts` | **New** | 15 tests for all changeset functions |

## What's Next

**Step 45 — SQLite Adapter:** Adapter interface and `better-sqlite3` implementation for the Repo.

[← Step 43: Single Executable](43-single-executable.md) | [Step 45: SQLite Adapter →](45-sqlite-adapter.md)

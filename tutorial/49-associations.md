[← Step 48: Migrations](48-migrations.md) | [Step 50: PostgreSQL Adapter →](50-postgresql-adapter.md)

# Step 49 — Associations

## What We're Building

Association declarations (`hasMany`, `belongsTo`, `hasOne`) on schemas, plus `Repo.preload()` that loads related records efficiently — one query per association, avoiding the N+1 problem. Equivalent to Ecto associations and `Repo.preload/2`.

## Concepts You'll Learn

- **hasMany / belongsTo / hasOne** — three core relationship types
- **Lazy schema references** — `() => Schema` to handle circular dependencies
- **Batch preloading** — single `WHERE IN (...)` query per association instead of N+1
- **N+1 prevention** — collect all IDs, fetch in one query, group by foreign key

## How It Works

```
UserSchema                        PostSchema
  hasMany posts → PostSchema        belongsTo user → UserSchema
  hasOne profile → ProfileSchema    foreignKey: user_id

repo.preload(UserSchema, users, ["posts", "profile"])
  → SELECT * FROM posts WHERE user_id IN (1, 2, 3)      // 1 query
  → SELECT * FROM profiles WHERE user_id IN (1, 2, 3)   // 1 query
  → attach results to each user record
```

The key insight: instead of loading posts for each user one at a time (N queries), we collect all user IDs, run a single `WHERE IN` query, then group the results back onto each user record.

## The Code

### `src/ember/schema.ts` — Association types and helpers

The schema module gains three new concepts: an `AssociationDef` interface describing a relationship, an `associations` field on every `Schema`, and three helper functions to declare associations.

Here is the full file:

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

A few things to notice:

**Lazy `() => Schema` references.** The `schema` field in `AssociationDef` is a function, not a direct reference. This avoids circular dependency issues — `UserSchema` references `PostSchema` and vice versa. At define-time the schemas may not exist yet, but by the time `preload()` calls `assoc.schema()`, both are fully initialized.

**`foreignKey` semantics differ by type:**
- `hasMany` / `hasOne` — the foreign key column lives on the **related** table (e.g., `posts.user_id`)
- `belongsTo` — the foreign key column lives on **this** table (e.g., `posts.user_id` when declared on PostSchema)

**Associations live in `SchemaOptions`.** They are passed as the third argument to `defineSchema()` and stored on the `Schema` object for the Repo to inspect at preload time.

### `src/ember/repo.ts` — `preload()` method

The `preload()` method was added to the `Repo` class. Here is the complete method:

```typescript
/**
 * Preload associations on a list of records.
 * Executes one query per association (avoids N+1).
 *
 * Usage:
 *   const users = repo.all(UserSchema);
 *   repo.preload(UserSchema, users, ["posts"]);
 *   // users[0].posts → [{ id: 1, title: "...", user_id: 1 }, ...]
 */
preload<T extends Record<string, unknown>>(
  schema: Schema,
  records: T[],
  associations: string[],
): T[] {
  if (records.length === 0) return records;

  for (const assocName of associations) {
    const assoc = schema.associations[assocName];
    if (!assoc) {
      throw new Error(`Unknown association "${assocName}" on schema "${schema.tableName}"`);
    }

    const relatedSchema = assoc.schema();

    if (assoc.type === "hasMany" || assoc.type === "hasOne") {
      // Foreign key is on the related table, pointing to this table's PK
      const ids = records.map((r) => r[schema.primaryKey]);
      const placeholders = ids.map(() => "?").join(", ");
      const related = this.adapter.all<Record<string, unknown>>(
        `SELECT * FROM ${relatedSchema.tableName} WHERE ${assoc.foreignKey} IN (${placeholders})`,
        ids,
      );

      // Group by foreign key
      const grouped = new Map<unknown, Record<string, unknown>[]>();
      for (const row of related) {
        const fk = row[assoc.foreignKey];
        if (!grouped.has(fk)) grouped.set(fk, []);
        grouped.get(fk)!.push(row);
      }

      for (const record of records) {
        const pk = record[schema.primaryKey];
        if (assoc.type === "hasMany") {
          (record as any)[assocName] = grouped.get(pk) ?? [];
        } else {
          (record as any)[assocName] = (grouped.get(pk) ?? [])[0] ?? null;
        }
      }
    } else if (assoc.type === "belongsTo") {
      // Foreign key is on this table, pointing to related table's PK
      const fkValues = records.map((r) => r[assoc.foreignKey]).filter((v) => v != null);
      if (fkValues.length === 0) {
        for (const record of records) {
          (record as any)[assocName] = null;
        }
        continue;
      }

      const unique = [...new Set(fkValues)];
      const placeholders = unique.map(() => "?").join(", ");
      const related = this.adapter.all<Record<string, unknown>>(
        `SELECT * FROM ${relatedSchema.tableName} WHERE ${relatedSchema.primaryKey} IN (${placeholders})`,
        unique,
      );

      const lookup = new Map<unknown, Record<string, unknown>>();
      for (const row of related) {
        lookup.set(row[relatedSchema.primaryKey], row);
      }

      for (const record of records) {
        const fk = record[assoc.foreignKey];
        (record as any)[assocName] = lookup.get(fk) ?? null;
      }
    }
  }

  return records;
}
```

Let's trace through each association type:

#### hasMany / hasOne preloading

For `hasMany` and `hasOne`, the foreign key lives on the **related** table. The algorithm:

1. **Collect IDs** — extract the primary key from each parent record: `records.map((r) => r[schema.primaryKey])` gives us `[1, 2, 3]`.

2. **Batch query** — run `SELECT * FROM posts WHERE user_id IN (?, ?, ?)` with params `[1, 2, 3]`. One query, regardless of how many parent records.

3. **Group results** — build a `Map<foreignKeyValue, rows[]>`. For each returned row, read the foreign key column and push the row into the appropriate group:

    ```typescript
    const grouped = new Map<unknown, Record<string, unknown>[]>();
    for (const row of related) {
      const fk = row[assoc.foreignKey];
      if (!grouped.has(fk)) grouped.set(fk, []);
      grouped.get(fk)!.push(row);
    }
    ```

4. **Attach to parents** — for each parent record, look up its primary key in the grouped map. For `hasMany`, attach the full array (or `[]` if none). For `hasOne`, attach only the first element (or `null`):

    ```typescript
    if (assoc.type === "hasMany") {
      (record as any)[assocName] = grouped.get(pk) ?? [];
    } else {
      (record as any)[assocName] = (grouped.get(pk) ?? [])[0] ?? null;
    }
    ```

#### belongsTo preloading

For `belongsTo`, the foreign key lives on **this** table. The algorithm differs:

1. **Collect foreign key values** — read the FK column from each record, filter out nulls: `records.map((r) => r[assoc.foreignKey]).filter((v) => v != null)`. If a post has `user_id: 5`, we need to fetch user 5.

2. **Deduplicate** — multiple posts may reference the same user. Use `new Set()` to get unique FK values, so we fetch each related record only once.

3. **Batch query** — run `SELECT * FROM users WHERE id IN (?, ?)` with the unique FK values.

4. **Build lookup map** — index the results by their primary key for O(1) access:

    ```typescript
    const lookup = new Map<unknown, Record<string, unknown>>();
    for (const row of related) {
      lookup.set(row[relatedSchema.primaryKey], row);
    }
    ```

5. **Attach to parents** — for each record, look up its FK value in the lookup map:

    ```typescript
    for (const record of records) {
      const fk = record[assoc.foreignKey];
      (record as any)[assocName] = lookup.get(fk) ?? null;
    }
    ```

### Putting it all together

```typescript
import { defineSchema, hasMany, belongsTo, hasOne } from "./ember/schema.js";
import { Repo } from "./ember/repo.js";

// Define schemas with associations
const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
}, {
  associations: {
    posts: hasMany(() => PostSchema, "user_id"),
    profile: hasOne(() => ProfileSchema, "user_id"),
  },
});

const PostSchema = defineSchema("posts", {
  user_id: { type: "integer" },
  title: { type: "string" },
  body: { type: "text" },
}, {
  associations: {
    user: belongsTo(() => UserSchema, "user_id"),
  },
});

const ProfileSchema = defineSchema("profiles", {
  user_id: { type: "integer" },
  bio: { type: "text" },
});

// Preload in action
const users = repo.all(UserSchema);
repo.preload(UserSchema, users, ["posts", "profile"]);

// Each user now has .posts (array) and .profile (object or null)
for (const user of users) {
  console.log(user.username, "has", (user as any).posts.length, "posts");
  console.log("  profile:", (user as any).profile?.bio ?? "(none)");
}

// Preload in the other direction
const posts = repo.all(PostSchema);
repo.preload(PostSchema, posts, ["user"]);

// Each post now has .user (object or null)
for (const post of posts) {
  console.log(post.title, "by", (post as any).user?.username);
}
```

## Try It Out

```bash
npm test
```

8 association tests pass covering hasMany, belongsTo, hasOne, multiple preloads, empty records, and error handling.

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/ember/schema.ts` | **Modified** | Added `AssociationDef`, `hasMany()`, `belongsTo()`, `hasOne()` |
| `src/ember/repo.ts` | **Modified** | Added `preload()` with batch `WHERE IN` loading |
| `test/association.test.ts` | **New** | 8 tests for all association types |

## What's Next

**Step 50 — PostgreSQL Adapter:** Same Adapter interface with a PostgreSQL backend and connection pooling.

[← Step 48: Migrations](48-migrations.md) | [Step 50: PostgreSQL Adapter →](50-postgresql-adapter.md)

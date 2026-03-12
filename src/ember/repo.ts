/**
 * Ember Repo -- Database operations via Schema + Changeset.
 *
 * Equivalent to Ecto.Repo in Elixir.
 * All database operations go through the Repo, which handles:
 * - Changeset validation before persistence
 * - Unique constraint checking
 * - Timestamps (inserted_at, updated_at)
 * - Type-safe CRUD operations
 */

import type { Adapter } from "./adapter.js";
import type { Schema } from "./schema.js";
import type { Changeset } from "./changeset.js";

export type RepoResult<T> =
  | { ok: true; data: T }
  | { ok: false; changeset: Changeset<T> };

export class Repo {
  constructor(private adapter: Adapter) {}

  /** Get all records from a schema's table. */
  all<T>(schema: Schema): T[] {
    return this.adapter.all<T>(`SELECT * FROM ${schema.tableName}`, []);
  }

  /** Get a record by primary key. */
  get<T>(schema: Schema, id: unknown): T | null {
    return this.adapter.get<T>(
      `SELECT * FROM ${schema.tableName} WHERE ${schema.primaryKey} = ?`,
      [id],
    );
  }

  /** Get a record by conditions. */
  getBy<T>(schema: Schema, conditions: Record<string, unknown>): T | null {
    const keys = Object.keys(conditions);
    const where = keys.map((k) => `${k} = ?`).join(" AND ");
    const values = keys.map((k) => conditions[k]);
    return this.adapter.get<T>(
      `SELECT * FROM ${schema.tableName} WHERE ${where} LIMIT 1`,
      values,
    );
  }

  /** Insert a record using a changeset. Validates and checks constraints. */
  insert<T extends Record<string, unknown>>(schema: Schema, cs: Changeset<T>): RepoResult<T> {
    cs.action = "insert";

    if (!cs.valid) {
      return { ok: false, changeset: cs };
    }

    // Check unique constraints
    for (const constraint of cs.constraints) {
      if (constraint.type === "unique") {
        const value = (cs.changes as Record<string, unknown>)[constraint.field];
        if (value !== undefined) {
          const existing = this.getBy(schema, { [constraint.field]: value });
          if (existing) {
            if (!cs.errors[constraint.field]) cs.errors[constraint.field] = [];
            cs.errors[constraint.field].push(constraint.message ?? "has already been taken");
            cs.valid = false;
            return { ok: false, changeset: cs };
          }
        }
      }
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

    const sql = `INSERT INTO ${schema.tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
    const result = this.adapter.run(sql, values);

    const data = { ...cs.data, ...changes, [schema.primaryKey]: result.lastInsertRowid } as T;
    return { ok: true, data };
  }

  /** Update a record using a changeset. */
  update<T extends Record<string, unknown>>(schema: Schema, cs: Changeset<T>): RepoResult<T> {
    cs.action = "update";

    if (!cs.valid) {
      return { ok: false, changeset: cs };
    }

    const id = (cs.data as Record<string, unknown>)[schema.primaryKey];
    if (id === undefined) {
      throw new Error("Cannot update record without primary key");
    }

    // Check unique constraints
    for (const constraint of cs.constraints) {
      if (constraint.type === "unique") {
        const value = (cs.changes as Record<string, unknown>)[constraint.field];
        if (value !== undefined) {
          const existing = this.getBy<Record<string, unknown>>(schema, { [constraint.field]: value });
          if (existing && existing[schema.primaryKey] !== id) {
            if (!cs.errors[constraint.field]) cs.errors[constraint.field] = [];
            cs.errors[constraint.field].push(constraint.message ?? "has already been taken");
            cs.valid = false;
            return { ok: false, changeset: cs };
          }
        }
      }
    }

    const changes = { ...cs.changes } as Record<string, unknown>;
    if (schema.timestamps) {
      changes.updated_at = new Date().toISOString();
    }

    const keys = Object.keys(changes);
    if (keys.length === 0) {
      // No changes — return data as-is
      return { ok: true, data: cs.data };
    }

    const set = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => changes[k]);
    values.push(id);

    const sql = `UPDATE ${schema.tableName} SET ${set} WHERE ${schema.primaryKey} = ?`;
    this.adapter.run(sql, values);

    const data = { ...cs.data, ...changes } as T;
    return { ok: true, data };
  }

  /** Delete a record by primary key. */
  delete(schema: Schema, id: unknown): boolean {
    const sql = `DELETE FROM ${schema.tableName} WHERE ${schema.primaryKey} = ?`;
    const result = this.adapter.run(sql, [id]);
    return result.changes > 0;
  }

  /** Insert multiple records at once. */
  insertAll<T>(schema: Schema, records: Record<string, unknown>[]): { count: number } {
    if (records.length === 0) return { count: 0 };

    const now = new Date().toISOString();
    let count = 0;

    this.adapter.transaction(() => {
      for (const record of records) {
        const data = { ...record };
        if (schema.timestamps) {
          data.inserted_at = now;
          data.updated_at = now;
        }
        const keys = Object.keys(data);
        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((k) => data[k]);
        this.adapter.run(
          `INSERT INTO ${schema.tableName} (${keys.join(", ")}) VALUES (${placeholders})`,
          values,
        );
        count++;
      }
    });

    return { count };
  }

  /** Run a function inside a transaction. */
  transaction<T>(fn: () => T): T {
    return this.adapter.transaction(fn);
  }

  /** Execute raw SQL query (SELECT). */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.adapter.all<T>(sql, params);
  }

  /** Execute raw SQL statement (INSERT/UPDATE/DELETE). */
  execute(sql: string, params: unknown[] = []) {
    return this.adapter.run(sql, params);
  }

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

  /** Close the underlying adapter. */
  close(): void {
    this.adapter.close();
  }
}

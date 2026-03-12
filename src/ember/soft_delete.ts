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

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

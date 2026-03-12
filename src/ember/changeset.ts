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

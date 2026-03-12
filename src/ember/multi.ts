/**
 * Ember Multi — composable multi-operation transactions.
 *
 * Inspired by Ecto.Multi. Chain multiple operations, then run them
 * all inside a single transaction. If any step fails, the entire
 * transaction rolls back.
 *
 * Usage:
 *   const result = multi()
 *     .insert("user", UserSchema, userChangeset)
 *     .run("welcome_email", (results) => sendEmail(results.user))
 *     .execute(repo);
 *
 *   if (result.ok) {
 *     result.results.user  // inserted user
 *   } else {
 *     result.failed // name of failed step
 *     result.error  // the error or failed changeset
 *   }
 */

import type { Schema } from "./schema.js";
import type { Changeset } from "./changeset.js";
import type { Repo, RepoResult } from "./repo.js";

type StepFn = (results: Record<string, unknown>) => unknown;

interface Step {
  name: string;
  type: "insert" | "update" | "delete" | "run";
  schema?: Schema;
  changeset?: Changeset<any>;
  id?: unknown;
  fn?: StepFn;
}

export type MultiResult =
  | { ok: true; results: Record<string, unknown> }
  | { ok: false; failed: string; error: unknown; results: Record<string, unknown> };

export class Multi {
  private steps: Step[] = [];

  /** Add an insert step. */
  insert(name: string, schema: Schema, cs: Changeset<any>): this {
    this.steps.push({ name, type: "insert", schema, changeset: cs });
    return this;
  }

  /** Add an update step. */
  update(name: string, schema: Schema, cs: Changeset<any>): this {
    this.steps.push({ name, type: "update", schema, changeset: cs });
    return this;
  }

  /** Add a delete step. */
  deleteStep(name: string, schema: Schema, id: unknown): this {
    this.steps.push({ name, type: "delete", schema, id });
    return this;
  }

  /** Add a custom function step. Receives all previous results. */
  run(name: string, fn: StepFn): this {
    this.steps.push({ name, type: "run", fn });
    return this;
  }

  /** Execute all steps inside a transaction. */
  execute(repo: Repo): MultiResult {
    const results: Record<string, unknown> = {};

    try {
      repo.transaction(() => {
        for (const step of this.steps) {
          switch (step.type) {
            case "insert": {
              const result = repo.insert(step.schema!, step.changeset!);
              if (!result.ok) {
                throw { __multi_fail: true, name: step.name, error: result.changeset };
              }
              results[step.name] = result.data;
              break;
            }
            case "update": {
              const result = repo.update(step.schema!, step.changeset!);
              if (!result.ok) {
                throw { __multi_fail: true, name: step.name, error: result.changeset };
              }
              results[step.name] = result.data;
              break;
            }
            case "delete": {
              const deleted = repo.delete(step.schema!, step.id);
              if (!deleted) {
                throw { __multi_fail: true, name: step.name, error: "record not found" };
              }
              results[step.name] = true;
              break;
            }
            case "run": {
              const value = step.fn!(results);
              results[step.name] = value;
              break;
            }
          }
        }
      });

      return { ok: true, results };
    } catch (err: any) {
      if (err?.__multi_fail) {
        return { ok: false, failed: err.name, error: err.error, results };
      }
      throw err; // re-throw unexpected errors
    }
  }
}

/** Create a new Multi chain. */
export function multi(): Multi {
  return new Multi();
}

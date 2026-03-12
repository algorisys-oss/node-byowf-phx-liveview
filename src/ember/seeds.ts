/**
 * Ember Seeds — database seeding infrastructure.
 *
 * Provides a structured way to populate databases with initial or test data.
 *
 * Usage:
 *   // priv/seeds.ts
 *   import { seed, runSeeds } from "./ember/seeds.js";
 *
 *   seed("users", (repo) => {
 *     repo.insertAll(UserSchema, [
 *       { username: "admin", email: "admin@app.com" },
 *       { username: "test", email: "test@app.com" },
 *     ]);
 *   });
 *
 *   runSeeds(repo);
 */

import type { Repo } from "./repo.js";

interface SeedEntry {
  name: string;
  fn: (repo: Repo) => void;
}

const seeds: SeedEntry[] = [];

/** Register a seed function. */
export function seed(name: string, fn: (repo: Repo) => void): void {
  seeds.push({ name, fn });
}

/** Run all registered seeds inside a transaction. */
export function runSeeds(repo: Repo, options: { log?: boolean } = {}): { seeded: string[] } {
  const log = options.log ?? true;
  const seeded: string[] = [];

  repo.transaction(() => {
    for (const entry of seeds) {
      if (log) console.log(`  Seeding: ${entry.name}`);
      entry.fn(repo);
      seeded.push(entry.name);
      if (log) console.log(`  ✓ ${entry.name} done`);
    }
  });

  return { seeded };
}

/** Clear all registered seeds (useful for testing). */
export function clearSeeds(): void {
  seeds.length = 0;
}

/** Get registered seed count. */
export function seedCount(): number {
  return seeds.length;
}

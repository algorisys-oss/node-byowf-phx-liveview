import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";
import { seed, runSeeds, clearSeeds, seedCount } from "../src/ember/seeds.js";

const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
});

let repo: Repo;

beforeEach(() => {
  clearSeeds();
  const adapter = new SQLiteAdapter(":memory:");
  adapter.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      inserted_at TEXT,
      updated_at TEXT
    )
  `);
  repo = new Repo(adapter);
});

afterEach(() => {
  clearSeeds();
});

describe("seed / runSeeds", () => {
  it("registers and runs seeds", () => {
    seed("users", (r) => {
      r.insertAll(UserSchema, [
        { username: "Alice", email: "alice@test.com" },
        { username: "Bob", email: "bob@test.com" },
      ]);
    });

    assert.equal(seedCount(), 1);
    const result = runSeeds(repo, { log: false });
    assert.deepEqual(result.seeded, ["users"]);
    assert.equal(repo.all(UserSchema).length, 2);
  });

  it("runs multiple seeds in order", () => {
    const order: string[] = [];

    seed("admins", (r) => {
      order.push("admins");
      r.insertAll(UserSchema, [{ username: "admin", email: "admin@app.com" }]);
    });

    seed("test-users", (r) => {
      order.push("test-users");
      r.insertAll(UserSchema, [{ username: "test", email: "test@app.com" }]);
    });

    runSeeds(repo, { log: false });
    assert.deepEqual(order, ["admins", "test-users"]);
    assert.equal(repo.all(UserSchema).length, 2);
  });

  it("rolls back all seeds on error", () => {
    seed("good", (r) => {
      r.insertAll(UserSchema, [{ username: "Alice", email: "a@b.com" }]);
    });

    seed("bad", () => {
      throw new Error("seed failure");
    });

    assert.throws(() => runSeeds(repo, { log: false }));
    // Transaction rolled back — no records
    assert.equal(repo.all(UserSchema).length, 0);
  });

  it("clearSeeds resets registry", () => {
    seed("test", () => {});
    assert.equal(seedCount(), 1);
    clearSeeds();
    assert.equal(seedCount(), 0);
  });

  it("handles empty seeds", () => {
    const result = runSeeds(repo, { log: false });
    assert.deepEqual(result.seeded, []);
  });
});

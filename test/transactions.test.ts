import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";
import { changeset, validateRequired } from "../src/ember/changeset.js";
import { multi } from "../src/ember/multi.js";

const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
  age: { type: "integer" },
});

let repo: Repo;
let adapter: SQLiteAdapter;

beforeEach(() => {
  adapter = new SQLiteAdapter(":memory:");
  adapter.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      age INTEGER DEFAULT 0,
      inserted_at TEXT,
      updated_at TEXT
    )
  `);
  repo = new Repo(adapter);
});

describe("Repo.transaction", () => {
  it("commits on success", () => {
    repo.transaction(() => {
      const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
      repo.insert(UserSchema, cs1);
      const cs2 = changeset({} as any, { username: "Bob", email: "b@b.com", age: 25 }, ["username", "email", "age"]);
      repo.insert(UserSchema, cs2);
    });
    assert.equal(repo.all(UserSchema).length, 2);
  });

  it("rolls back on error", () => {
    assert.throws(() => {
      repo.transaction(() => {
        const cs = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
        repo.insert(UserSchema, cs);
        throw new Error("boom");
      });
    });
    assert.equal(repo.all(UserSchema).length, 0);
  });
});

describe("Multi", () => {
  it("executes multiple operations atomically", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const cs2 = changeset({} as any, { username: "Bob", email: "b@b.com", age: 25 }, ["username", "email", "age"]);

    const result = multi()
      .insert("alice", UserSchema, cs1)
      .insert("bob", UserSchema, cs2)
      .run("count", () => repo.all(UserSchema).length)
      .execute(repo);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.results.alice as any).username, "Alice");
      assert.equal((result.results.bob as any).username, "Bob");
      assert.equal(result.results.count, 2);
    }
  });

  it("rolls back on failed insert", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const cs2 = changeset({} as any, { email: "b@b.com" }, ["username", "email"]);
    validateRequired(cs2, ["username"]);

    const result = multi()
      .insert("alice", UserSchema, cs1)
      .insert("bob", UserSchema, cs2)
      .execute(repo);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failed, "bob");
    }
    // Transaction rolled back — no records
    assert.equal(repo.all(UserSchema).length, 0);
  });

  it("supports delete steps", () => {
    const cs = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const ins = repo.insert(UserSchema, cs);
    assert.ok(ins.ok);

    const result = multi()
      .deleteStep("remove_alice", UserSchema, ins.ok ? ins.data.id : 0)
      .execute(repo);

    assert.equal(result.ok, true);
    assert.equal(repo.all(UserSchema).length, 0);
  });
});

describe("Repo.aggregate", () => {
  beforeEach(() => {
    repo.insertAll(UserSchema, [
      { username: "Alice", email: "a@b.com", age: 30 },
      { username: "Bob", email: "b@b.com", age: 25 },
      { username: "Charlie", email: "c@b.com", age: 35 },
    ]);
  });

  it("counts records", () => {
    assert.equal(repo.aggregate(UserSchema, "count"), 3);
  });

  it("counts with conditions", () => {
    assert.equal(repo.aggregate(UserSchema, "count", "*", { username: "Alice" }), 1);
  });

  it("sums a column", () => {
    assert.equal(repo.aggregate(UserSchema, "sum", "age"), 90);
  });

  it("averages a column", () => {
    assert.equal(repo.aggregate(UserSchema, "avg", "age"), 30);
  });

  it("gets min/max", () => {
    assert.equal(repo.aggregate(UserSchema, "min", "age"), 25);
    assert.equal(repo.aggregate(UserSchema, "max", "age"), 35);
  });
});

describe("Repo.upsert", () => {
  it("inserts when no conflict", () => {
    const cs = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    const result = repo.upsert(UserSchema, cs, ["email"]);
    assert.equal(result.ok, true);
    assert.equal(repo.all(UserSchema).length, 1);
  });

  it("updates on conflict", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "a@b.com", age: 30 }, ["username", "email", "age"]);
    repo.insert(UserSchema, cs1);

    const cs2 = changeset({} as any, { username: "Alice Updated", email: "a@b.com", age: 31 }, ["username", "email", "age"]);
    const result = repo.upsert(UserSchema, cs2, ["email"]);
    assert.equal(result.ok, true);

    const users = repo.all<any>(UserSchema);
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "Alice Updated");
    assert.equal(users[0].age, 31);
  });

  it("rejects invalid changeset", () => {
    const cs = changeset({} as any, { email: "a@b.com" }, ["username", "email"]);
    validateRequired(cs, ["username"]);
    const result = repo.upsert(UserSchema, cs, ["email"]);
    assert.equal(result.ok, false);
  });
});

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";
import { changeset, validateRequired, uniqueConstraint } from "../src/ember/changeset.js";

const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
});

let repo: Repo;

beforeEach(() => {
  const adapter = new SQLiteAdapter(":memory:");
  adapter.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      inserted_at TEXT,
      updated_at TEXT
    )
  `);
  repo = new Repo(adapter);
});

describe("Repo.insert", () => {
  it("inserts a valid changeset", () => {
    const cs = changeset({} as any, { username: "Alice", email: "alice@test.com" }, ["username", "email"]);
    validateRequired(cs, ["username", "email"]);
    const result = repo.insert(UserSchema, cs);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.username, "Alice");
      assert.ok(result.data.id);
      assert.ok(result.data.inserted_at);
    }
  });

  it("rejects invalid changeset", () => {
    const cs = changeset({} as any, { email: "test@test.com" }, ["username", "email"]);
    validateRequired(cs, ["username"]);
    const result = repo.insert(UserSchema, cs);
    assert.equal(result.ok, false);
  });

  it("checks unique constraints", () => {
    const cs1 = changeset({} as any, { username: "Alice", email: "alice@test.com" }, ["username", "email"]);
    repo.insert(UserSchema, cs1);

    const cs2 = changeset({} as any, { username: "Bob", email: "alice@test.com" }, ["username", "email"]);
    uniqueConstraint(cs2, "email");
    const result = repo.insert(UserSchema, cs2);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.changeset.errors.email?.includes("has already been taken"));
    }
  });
});

describe("Repo.get / Repo.all / Repo.getBy", () => {
  it("gets by id", () => {
    const cs = changeset({} as any, { username: "Alice", email: "a@b.com" }, ["username", "email"]);
    const ins = repo.insert(UserSchema, cs);
    assert.equal(ins.ok, true);

    const user = repo.get<any>(UserSchema, ins.ok ? ins.data.id : 0);
    assert.equal(user?.username, "Alice");
  });

  it("returns null for missing id", () => {
    const user = repo.get(UserSchema, 999);
    assert.equal(user, null);
  });

  it("gets all records", () => {
    repo.insert(UserSchema, changeset({} as any, { username: "A", email: "a@b.com" }, ["username", "email"]));
    repo.insert(UserSchema, changeset({} as any, { username: "B", email: "b@b.com" }, ["username", "email"]));
    const users = repo.all(UserSchema);
    assert.equal(users.length, 2);
  });

  it("gets by condition", () => {
    repo.insert(UserSchema, changeset({} as any, { username: "Alice", email: "a@b.com" }, ["username", "email"]));
    const user = repo.getBy<any>(UserSchema, { email: "a@b.com" });
    assert.equal(user?.username, "Alice");
  });
});

describe("Repo.update", () => {
  it("updates a record", () => {
    const ins = repo.insert(UserSchema, changeset({} as any, { username: "Alice", email: "a@b.com" }, ["username", "email"]));
    assert.ok(ins.ok);
    if (!ins.ok) return;

    const cs = changeset(ins.data, { username: "Alice Updated" }, ["username"]);
    const result = repo.update(UserSchema, cs);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.username, "Alice Updated");

    const fresh = repo.get<any>(UserSchema, ins.data.id);
    assert.equal(fresh?.username, "Alice Updated");
  });
});

describe("Repo.delete", () => {
  it("deletes a record", () => {
    const ins = repo.insert(UserSchema, changeset({} as any, { username: "A", email: "a@b.com" }, ["username", "email"]));
    assert.ok(ins.ok);
    if (!ins.ok) return;

    const deleted = repo.delete(UserSchema, ins.data.id);
    assert.equal(deleted, true);
    assert.equal(repo.get(UserSchema, ins.data.id), null);
  });
});

describe("Repo.insertAll", () => {
  it("inserts multiple records", () => {
    const result = repo.insertAll(UserSchema, [
      { username: "A", email: "a@b.com" },
      { username: "B", email: "b@b.com" },
    ]);
    assert.equal(result.count, 2);
    assert.equal(repo.all(UserSchema).length, 2);
  });
});

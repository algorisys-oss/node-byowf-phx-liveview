import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";
import { changeset } from "../src/ember/changeset.js";
import {
  softDelete,
  restore,
  allActive,
  allTrashed,
  withTrashed,
  getActive,
  purgeTrashed,
} from "../src/ember/soft_delete.js";

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
      email TEXT NOT NULL,
      deleted_at TEXT,
      inserted_at TEXT,
      updated_at TEXT
    )
  `);
  repo = new Repo(adapter);

  // Insert test data
  repo.insertAll(UserSchema, [
    { username: "Alice", email: "alice@test.com" },
    { username: "Bob", email: "bob@test.com" },
    { username: "Charlie", email: "charlie@test.com" },
  ]);
});

describe("softDelete", () => {
  it("soft-deletes a record", () => {
    const users = repo.all<any>(UserSchema);
    const result = softDelete(repo, UserSchema, users[0].id);
    assert.equal(result, true);

    const active = allActive(repo, UserSchema);
    assert.equal(active.length, 2);
  });

  it("returns false for non-existent id", () => {
    assert.equal(softDelete(repo, UserSchema, 999), false);
  });

  it("returns false for already-deleted record", () => {
    const users = repo.all<any>(UserSchema);
    softDelete(repo, UserSchema, users[0].id);
    // Second delete should return false
    assert.equal(softDelete(repo, UserSchema, users[0].id), false);
  });
});

describe("restore", () => {
  it("restores a soft-deleted record", () => {
    const users = repo.all<any>(UserSchema);
    softDelete(repo, UserSchema, users[0].id);
    assert.equal(allActive(repo, UserSchema).length, 2);

    const restored = restore(repo, UserSchema, users[0].id);
    assert.equal(restored, true);
    assert.equal(allActive(repo, UserSchema).length, 3);
  });

  it("returns false for non-deleted record", () => {
    const users = repo.all<any>(UserSchema);
    assert.equal(restore(repo, UserSchema, users[0].id), false);
  });
});

describe("allActive / allTrashed / withTrashed", () => {
  it("filters correctly", () => {
    const users = repo.all<any>(UserSchema);
    softDelete(repo, UserSchema, users[0].id);

    assert.equal(allActive(repo, UserSchema).length, 2);
    assert.equal(allTrashed(repo, UserSchema).length, 1);
    assert.equal(withTrashed(repo, UserSchema).length, 3);
  });
});

describe("getActive", () => {
  it("returns active record", () => {
    const users = repo.all<any>(UserSchema);
    const user = getActive<any>(repo, UserSchema, users[0].id);
    assert.equal(user?.username, "Alice");
  });

  it("returns null for soft-deleted record", () => {
    const users = repo.all<any>(UserSchema);
    softDelete(repo, UserSchema, users[0].id);
    assert.equal(getActive(repo, UserSchema, users[0].id), null);
  });
});

describe("purgeTrashed", () => {
  it("permanently deletes soft-deleted records", () => {
    const users = repo.all<any>(UserSchema);
    softDelete(repo, UserSchema, users[0].id);
    softDelete(repo, UserSchema, users[1].id);

    const purged = purgeTrashed(repo, UserSchema);
    assert.equal(purged, 2);
    assert.equal(withTrashed(repo, UserSchema).length, 1);
    assert.equal(allTrashed(repo, UserSchema).length, 0);
  });
});

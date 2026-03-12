import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";
import { paginate, paginateQuery } from "../src/ember/pagination.js";
import { from } from "../src/ember/query.js";

const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
  active: { type: "boolean" },
});

let repo: Repo;

beforeEach(() => {
  const adapter = new SQLiteAdapter(":memory:");
  adapter.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      inserted_at TEXT,
      updated_at TEXT
    )
  `);
  repo = new Repo(adapter);

  // Insert 25 users
  const records = Array.from({ length: 25 }, (_, i) => ({
    username: `user_${String(i + 1).padStart(2, "0")}`,
    email: `user${i + 1}@test.com`,
    active: i < 20 ? 1 : 0,
  }));
  repo.insertAll(UserSchema, records);
});

describe("paginate", () => {
  it("returns first page with defaults", () => {
    const page = paginate(repo, UserSchema);
    assert.equal(page.page, 1);
    assert.equal(page.perPage, 20);
    assert.equal(page.total, 25);
    assert.equal(page.totalPages, 2);
    assert.equal(page.data.length, 20);
  });

  it("returns specific page", () => {
    const page = paginate(repo, UserSchema, { page: 2, perPage: 10 });
    assert.equal(page.page, 2);
    assert.equal(page.perPage, 10);
    assert.equal(page.total, 25);
    assert.equal(page.totalPages, 3);
    assert.equal(page.data.length, 10);
  });

  it("returns last page with remainder", () => {
    const page = paginate(repo, UserSchema, { page: 3, perPage: 10 });
    assert.equal(page.data.length, 5);
    assert.equal(page.totalPages, 3);
  });

  it("returns empty data for page beyond range", () => {
    const page = paginate(repo, UserSchema, { page: 100, perPage: 10 });
    assert.equal(page.data.length, 0);
    assert.equal(page.total, 25);
  });

  it("handles perPage of 1", () => {
    const page = paginate(repo, UserSchema, { page: 1, perPage: 1 });
    assert.equal(page.data.length, 1);
    assert.equal(page.totalPages, 25);
  });

  it("clamps negative page to 1", () => {
    const page = paginate(repo, UserSchema, { page: -5, perPage: 10 });
    assert.equal(page.page, 1);
  });

  it("filters with conditions", () => {
    const page = paginate(repo, UserSchema, { perPage: 10, conditions: { active: 0 } });
    assert.equal(page.total, 5);
    assert.equal(page.data.length, 5);
    assert.equal(page.totalPages, 1);
  });
});

describe("paginateQuery", () => {
  it("paginates a query builder result", () => {
    const q = from("users").whereEq("active", 1);
    const page = paginateQuery(repo, q, { page: 1, perPage: 10 });
    assert.equal(page.total, 20);
    assert.equal(page.data.length, 10);
    assert.equal(page.totalPages, 2);
  });

  it("paginates with ordering", () => {
    const q = from("users").whereEq("active", 1).orderBy("username", "desc");
    const page = paginateQuery<{ username: string }>(repo, q, { page: 1, perPage: 5 });
    assert.equal(page.data.length, 5);
    // Descending order — user_20, user_19, ...
    assert.equal(page.data[0].username, "user_20");
  });
});

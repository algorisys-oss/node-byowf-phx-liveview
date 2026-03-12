import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { from } from "../src/ember/query.js";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema } from "../src/ember/schema.js";

describe("Query Builder — SQL generation", () => {
  it("basic select all", () => {
    const [sql, params] = from("users").toSql();
    assert.equal(sql, "SELECT * FROM users");
    assert.deepEqual(params, []);
  });

  it("select specific columns", () => {
    const [sql] = from("users").select(["username", "email"]).toSql();
    assert.equal(sql, "SELECT username, email FROM users");
  });

  it("select distinct", () => {
    const [sql] = from("users").select(["role"]).distinct().toSql();
    assert.equal(sql, "SELECT DISTINCT role FROM users");
  });

  it("where with equals", () => {
    const [sql, params] = from("users").whereEq("active", true).toSql();
    assert.equal(sql, "SELECT * FROM users WHERE active = ?");
    assert.deepEqual(params, [true]);
  });

  it("multiple where conditions", () => {
    const [sql, params] = from("users")
      .where("age", ">=", 18)
      .where("active", "=", true)
      .toSql();
    assert.equal(sql, "SELECT * FROM users WHERE age >= ? AND active = ?");
    assert.deepEqual(params, [18, true]);
  });

  it("where IN", () => {
    const [sql, params] = from("users").whereIn("role", ["admin", "mod"]).toSql();
    assert.equal(sql, "SELECT * FROM users WHERE role IN (?, ?)");
    assert.deepEqual(params, ["admin", "mod"]);
  });

  it("where IS NULL / IS NOT NULL", () => {
    const [sql1, params1] = from("users").whereNull("deleted_at").toSql();
    assert.equal(sql1, "SELECT * FROM users WHERE deleted_at IS NULL");
    assert.deepEqual(params1, []);

    const [sql2] = from("users").whereNotNull("email").toSql();
    assert.equal(sql2, "SELECT * FROM users WHERE email IS NOT NULL");
  });

  it("where LIKE", () => {
    const [sql, params] = from("users").whereLike("username", "%alice%").toSql();
    assert.equal(sql, "SELECT * FROM users WHERE username LIKE ?");
    assert.deepEqual(params, ["%alice%"]);
  });

  it("order by", () => {
    const [sql] = from("users").orderBy("username", "asc").orderBy("id", "desc").toSql();
    assert.equal(sql, "SELECT * FROM users ORDER BY username ASC, id DESC");
  });

  it("limit and offset", () => {
    const [sql] = from("users").limit(10).offset(20).toSql();
    assert.equal(sql, "SELECT * FROM users LIMIT 10 OFFSET 20");
  });

  it("group by with having", () => {
    const [sql, params] = from("orders")
      .select(["user_id", "COUNT(*) as total"])
      .groupBy("user_id")
      .having("COUNT(*)", ">", 5)
      .toSql();
    assert.equal(sql, "SELECT user_id, COUNT(*) as total FROM orders GROUP BY user_id HAVING COUNT(*) > ?");
    assert.deepEqual(params, [5]);
  });

  it("toDeleteSql", () => {
    const [sql, params] = from("users").whereEq("id", 42).toDeleteSql();
    assert.equal(sql, "DELETE FROM users WHERE id = ?");
    assert.deepEqual(params, [42]);
  });

  it("toCountSql", () => {
    const [sql, params] = from("users").where("age", ">", 18).toCountSql();
    assert.equal(sql, "SELECT COUNT(*) as count FROM users WHERE age > ?");
    assert.deepEqual(params, [18]);
  });

  it("complex query", () => {
    const [sql, params] = from("users")
      .select(["username", "email"])
      .where("active", "=", true)
      .where("age", ">=", 18)
      .whereLike("email", "%@company.com")
      .orderBy("username")
      .limit(25)
      .offset(50)
      .toSql();
    assert.equal(
      sql,
      "SELECT username, email FROM users WHERE active = ? AND age >= ? AND email LIKE ? ORDER BY username ASC LIMIT 25 OFFSET 50",
    );
    assert.deepEqual(params, [true, 18, "%@company.com"]);
  });
});

const UserSchema = defineSchema("users", {
  username: { type: "string" },
  email: { type: "string" },
  age: { type: "integer" },
});

describe("Query Builder — with Repo", () => {
  let repo: Repo;

  beforeEach(() => {
    const adapter = new SQLiteAdapter(":memory:");
    adapter.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER DEFAULT 0,
        inserted_at TEXT,
        updated_at TEXT
      )
    `);
    repo = new Repo(adapter);
    repo.insertAll(UserSchema, [
      { username: "Alice", email: "alice@test.com", age: 30 },
      { username: "Bob", email: "bob@test.com", age: 17 },
      { username: "Charlie", email: "charlie@test.com", age: 25 },
    ]);
  });

  it("executes query via repo.all with query", () => {
    const q = from("users").where("age", ">=", 18).orderBy("username");
    const [sql, params] = q.toSql();
    const users = repo.query<{ username: string }>(sql, params);
    assert.equal(users.length, 2);
    assert.equal(users[0].username, "Alice");
    assert.equal(users[1].username, "Charlie");
  });

  it("counts records", () => {
    const [sql, params] = from("users").where("age", ">=", 18).toCountSql();
    const result = repo.query<{ count: number }>(sql, params);
    assert.equal(result[0].count, 2);
  });

  it("deletes via query", () => {
    const [sql, params] = from("users").where("age", "<", 18).toDeleteSql();
    repo.execute(sql, params);
    const all = repo.all(UserSchema);
    assert.equal(all.length, 2);
  });

  it("paginates with limit/offset", () => {
    const [sql, params] = from("users").orderBy("username").limit(2).offset(1).toSql();
    const users = repo.query<{ username: string }>(sql, params);
    assert.equal(users.length, 2);
    assert.equal(users[0].username, "Bob");
    assert.equal(users[1].username, "Charlie");
  });
});

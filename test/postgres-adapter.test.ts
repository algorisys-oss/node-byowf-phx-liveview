import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { convertPlaceholders, PostgresAdapter } from "../src/ember/adapters/postgres.js";

describe("convertPlaceholders", () => {
  it("converts ? to $1, $2, ...", () => {
    assert.equal(convertPlaceholders("SELECT * FROM users WHERE id = ?"), "SELECT * FROM users WHERE id = $1");
  });

  it("converts multiple placeholders", () => {
    assert.equal(
      convertPlaceholders("INSERT INTO users (name, email) VALUES (?, ?)"),
      "INSERT INTO users (name, email) VALUES ($1, $2)",
    );
  });

  it("handles no placeholders", () => {
    assert.equal(convertPlaceholders("SELECT * FROM users"), "SELECT * FROM users");
  });

  it("ignores ? inside single quotes", () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM users WHERE name = '?' AND id = ?"),
      "SELECT * FROM users WHERE name = '?' AND id = $1",
    );
  });

  it("ignores ? inside double quotes", () => {
    assert.equal(
      convertPlaceholders('SELECT * FROM "table?" WHERE id = ?'),
      'SELECT * FROM "table?" WHERE id = $1',
    );
  });

  it("handles complex query", () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM users WHERE age > ? AND name LIKE ? ORDER BY ? LIMIT ?"),
      "SELECT * FROM users WHERE age > $1 AND name LIKE $2 ORDER BY $3 LIMIT $4",
    );
  });
});

describe("PostgresAdapter", () => {
  it("can be constructed without connecting", () => {
    const adapter = new PostgresAdapter({ connectionString: "postgres://localhost/test" });
    assert.ok(adapter);
  });

  it("throws on sync methods (must use async variants)", () => {
    const adapter = new PostgresAdapter({ connectionString: "postgres://localhost/test" });
    assert.throws(() => adapter.all("SELECT 1", []));
    assert.throws(() => adapter.get("SELECT 1", []));
    assert.throws(() => adapter.run("INSERT", []));
    assert.throws(() => adapter.exec("CREATE TABLE"));
    assert.throws(() => adapter.transaction(() => {}));
  });

  it("close() is safe to call before connect()", () => {
    const adapter = new PostgresAdapter({ connectionString: "postgres://localhost/test" });
    adapter.close(); // should not throw
  });
});

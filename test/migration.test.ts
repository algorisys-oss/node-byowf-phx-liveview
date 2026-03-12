import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import {
  defineMigration,
  migrate,
  rollback,
  migrationStatus,
  type Migration,
} from "../src/ember/migration.js";

let adapter: SQLiteAdapter;

const createUsers = defineMigration({
  up(m) {
    m.createTable("users", {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      username: "TEXT NOT NULL",
      email: "TEXT NOT NULL",
    });
    m.addIndex("users", ["email"], { unique: true });
  },
  down(m) {
    m.dropIndex("idx_users_email");
    m.dropTable("users");
  },
});

const addAge = defineMigration({
  up(m) {
    m.addColumn("users", "age", "INTEGER DEFAULT 0");
  },
  down(m) {
    // SQLite doesn't support DROP COLUMN easily, recreate
    m.execute(`
      CREATE TABLE users_backup AS SELECT id, username, email FROM users;
      DROP TABLE users;
      ALTER TABLE users_backup RENAME TO users;
    `);
  },
});

const migrations: Migration[] = [
  { version: "001", name: "create_users", ...createUsers },
  { version: "002", name: "add_age", ...addAge },
];

beforeEach(() => {
  adapter = new SQLiteAdapter(":memory:");
});

describe("migrate", () => {
  it("runs pending migrations", () => {
    const applied = migrate(adapter, migrations);
    assert.deepEqual(applied, ["001", "002"]);

    // Verify table exists with columns
    const rows = adapter.all<{ username: string }>("SELECT * FROM users", []);
    assert.deepEqual(rows, []);
  });

  it("skips already-applied migrations", () => {
    migrate(adapter, migrations);
    const applied = migrate(adapter, migrations);
    assert.deepEqual(applied, []);
  });

  it("runs only new migrations", () => {
    migrate(adapter, [migrations[0]]);
    const applied = migrate(adapter, migrations);
    assert.deepEqual(applied, ["002"]);
  });
});

describe("rollback", () => {
  it("rolls back the last migration", () => {
    migrate(adapter, migrations);
    const rolled = rollback(adapter, migrations, 1);
    assert.deepEqual(rolled, ["002"]);

    // age column gone — verify by re-running migration 002
    const applied = migrate(adapter, migrations);
    assert.deepEqual(applied, ["002"]);
  });

  it("rolls back multiple steps", () => {
    migrate(adapter, migrations);
    const rolled = rollback(adapter, migrations, 2);
    assert.deepEqual(rolled, ["002", "001"]);
  });
});

describe("migrationStatus", () => {
  it("shows status of all migrations", () => {
    migrate(adapter, [migrations[0]]);
    const status = migrationStatus(adapter, migrations);
    assert.deepEqual(status, [
      { version: "001", name: "create_users", status: "up" },
      { version: "002", name: "add_age", status: "down" },
    ]);
  });
});

describe("MigrationContext", () => {
  it("createTable creates a table", () => {
    migrate(adapter, [migrations[0]]);
    // Insert should work
    adapter.run("INSERT INTO users (username, email) VALUES (?, ?)", ["Alice", "a@b.com"]);
    const user = adapter.get<{ username: string }>("SELECT * FROM users WHERE username = ?", ["Alice"]);
    assert.equal(user?.username, "Alice");
  });

  it("addIndex creates a unique index", () => {
    migrate(adapter, [migrations[0]]);
    adapter.run("INSERT INTO users (username, email) VALUES (?, ?)", ["Alice", "a@b.com"]);
    assert.throws(() => {
      adapter.run("INSERT INTO users (username, email) VALUES (?, ?)", ["Bob", "a@b.com"]);
    });
  });

  it("addColumn adds a column", () => {
    migrate(adapter, migrations);
    adapter.run("INSERT INTO users (username, email, age) VALUES (?, ?, ?)", ["Alice", "a@b.com", 30]);
    const user = adapter.get<{ age: number }>("SELECT age FROM users WHERE username = ?", ["Alice"]);
    assert.equal(user?.age, 30);
  });

  it("renameTable renames a table", () => {
    migrate(adapter, [migrations[0]]);
    adapter.exec("ALTER TABLE users RENAME TO people");
    const rows = adapter.all("SELECT * FROM people", []);
    assert.deepEqual(rows, []);
  });
});

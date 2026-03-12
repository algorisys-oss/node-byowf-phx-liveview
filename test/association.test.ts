import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SQLiteAdapter } from "../src/ember/adapters/sqlite.js";
import { Repo } from "../src/ember/repo.js";
import { defineSchema, hasMany, belongsTo, hasOne } from "../src/ember/schema.js";
import { changeset } from "../src/ember/changeset.js";

// Lazy references to handle circular dependencies
const UserSchema = defineSchema(
  "users",
  {
    username: { type: "string" },
    email: { type: "string" },
  },
  {
    associations: {
      posts: hasMany(() => PostSchema, "user_id"),
      profile: hasOne(() => ProfileSchema, "user_id"),
    },
  },
);

const PostSchema = defineSchema(
  "posts",
  {
    title: { type: "string" },
    user_id: { type: "integer" },
  },
  {
    associations: {
      user: belongsTo(() => UserSchema, "user_id"),
    },
  },
);

const ProfileSchema = defineSchema(
  "profiles",
  {
    bio: { type: "string" },
    user_id: { type: "integer" },
  },
  {
    associations: {
      user: belongsTo(() => UserSchema, "user_id"),
    },
  },
);

let repo: Repo;

beforeEach(() => {
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
  adapter.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      inserted_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  adapter.exec(`
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bio TEXT,
      user_id INTEGER NOT NULL UNIQUE,
      inserted_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  repo = new Repo(adapter);
});

function insertUser(username: string, email: string) {
  const cs = changeset({} as any, { username, email }, ["username", "email"]);
  return repo.insert(UserSchema, cs);
}

function insertPost(title: string, userId: number) {
  const cs = changeset({} as any, { title, user_id: userId }, ["title", "user_id"]);
  return repo.insert(PostSchema, cs);
}

function insertProfile(bio: string, userId: number) {
  const cs = changeset({} as any, { bio, user_id: userId }, ["bio", "user_id"]);
  return repo.insert(ProfileSchema, cs);
}

describe("hasMany", () => {
  it("preloads hasMany associations", () => {
    const u1 = insertUser("Alice", "alice@test.com");
    const u2 = insertUser("Bob", "bob@test.com");
    assert.ok(u1.ok && u2.ok);

    insertPost("Post 1", u1.data.id as number);
    insertPost("Post 2", u1.data.id as number);
    insertPost("Post 3", u2.data.id as number);

    const users = repo.all<any>(UserSchema);
    repo.preload(UserSchema, users, ["posts"]);

    const alice = users.find((u: any) => u.username === "Alice");
    const bob = users.find((u: any) => u.username === "Bob");
    assert.equal(alice.posts.length, 2);
    assert.equal(bob.posts.length, 1);
    assert.equal(alice.posts[0].title, "Post 1");
  });

  it("returns empty array for no related records", () => {
    insertUser("Alice", "alice@test.com");
    const users = repo.all<any>(UserSchema);
    repo.preload(UserSchema, users, ["posts"]);
    assert.deepEqual(users[0].posts, []);
  });
});

describe("belongsTo", () => {
  it("preloads belongsTo associations", () => {
    const u1 = insertUser("Alice", "alice@test.com");
    assert.ok(u1.ok);

    insertPost("Post 1", u1.data.id as number);
    insertPost("Post 2", u1.data.id as number);

    const posts = repo.all<any>(PostSchema);
    repo.preload(PostSchema, posts, ["user"]);

    assert.equal(posts[0].user.username, "Alice");
    assert.equal(posts[1].user.username, "Alice");
  });

  it("returns null for missing related record", () => {
    // Insert user then post, then delete user (FK not enforced on delete by default)
    const adapter = (repo as any).adapter;
    adapter.exec("PRAGMA foreign_keys = OFF");
    adapter.run("INSERT INTO posts (title, user_id) VALUES (?, ?)", ["Orphan", 999]);
    adapter.exec("PRAGMA foreign_keys = ON");

    const posts = repo.all<any>(PostSchema);
    repo.preload(PostSchema, posts, ["user"]);
    assert.equal(posts[0].user, null);
  });
});

describe("hasOne", () => {
  it("preloads hasOne associations", () => {
    const u1 = insertUser("Alice", "alice@test.com");
    const u2 = insertUser("Bob", "bob@test.com");
    assert.ok(u1.ok && u2.ok);

    insertProfile("Alice's bio", u1.data.id as number);

    const users = repo.all<any>(UserSchema);
    repo.preload(UserSchema, users, ["profile"]);

    const alice = users.find((u: any) => u.username === "Alice");
    const bob = users.find((u: any) => u.username === "Bob");
    assert.equal(alice.profile.bio, "Alice's bio");
    assert.equal(bob.profile, null);
  });
});

describe("multiple associations", () => {
  it("preloads multiple associations at once", () => {
    const u1 = insertUser("Alice", "alice@test.com");
    assert.ok(u1.ok);

    insertPost("Post 1", u1.data.id as number);
    insertProfile("Alice's bio", u1.data.id as number);

    const users = repo.all<any>(UserSchema);
    repo.preload(UserSchema, users, ["posts", "profile"]);

    assert.equal(users[0].posts.length, 1);
    assert.equal(users[0].profile.bio, "Alice's bio");
  });
});

describe("empty records", () => {
  it("handles empty records array gracefully", () => {
    const result = repo.preload(UserSchema, [], ["posts"]);
    assert.deepEqual(result, []);
  });
});

describe("unknown association", () => {
  it("throws for unknown association name", () => {
    const users = repo.all<any>(UserSchema);
    insertUser("Alice", "alice@test.com");
    assert.throws(() => {
      repo.preload(UserSchema, [{}], ["nonexistent"]);
    }, /Unknown association/);
  });
});

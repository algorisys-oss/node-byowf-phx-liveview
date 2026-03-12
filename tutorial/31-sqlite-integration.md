# Step 31 — SQLite Integration

## What We're Building

A `Database` class wrapping `better-sqlite3` with WAL mode, parameterized queries, and a built-in migration system. Demonstrated with a real-time guestbook that persists entries across server restarts.

Until now, all our data lived in memory — counters, streams, presence, all gone on restart. This step introduces persistent storage via SQLite, the most deployed database in the world.

## Concepts You'll Learn

- **`better-sqlite3`** — synchronous, native SQLite bindings for Node.js
- **WAL mode** — Write-Ahead Logging for better concurrent reads
- **Parameterized queries** — SQL injection prevention via `?` placeholders
- **Schema migrations** — version-tracked, reversible database changes
- **Transactions** — atomic multi-statement operations

## How It Works

### Database Class

The `Database` class wraps `better-sqlite3` with a simple, consistent API:

```typescript
import { Database } from "../blaze/database.js";

const db = new Database("myapp.db");

// Query helpers
db.all("SELECT * FROM users WHERE active = ?", 1);     // → rows[]
db.get("SELECT * FROM users WHERE id = ?", 42);         // → row | null
db.run("INSERT INTO users (name) VALUES (?)", "Alice");  // → { changes, lastInsertRowid }
db.exec("CREATE TABLE ...");                              // raw SQL (no params)
```

### Why better-sqlite3?

| Feature | better-sqlite3 | node:sqlite (experimental) |
|---------|----------------|---------------------------|
| Stability | Production-ready | Experimental (Node 22.5+) |
| API | Synchronous, simple | Async, lower-level |
| Performance | Fastest Node.js SQLite | Not yet optimized |
| Transactions | `db.transaction()` | Manual BEGIN/COMMIT |

`better-sqlite3` is synchronous by design — SQLite operations are fast enough that async overhead would slow things down. This matches `bun:sqlite`'s approach.

### Migration System

Migrations are plain objects with `version`, `name`, `up`, and `down` SQL:

```typescript
const migrations = [
  {
    version: 1,
    name: "create_users",
    up: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    down: "DROP TABLE users",
  },
  {
    version: 2,
    name: "add_email",
    up: "ALTER TABLE users ADD COLUMN email TEXT",
    down: "ALTER TABLE users DROP COLUMN email",
  },
];

const { applied } = db.migrate(migrations);
// Creates schema_migrations table, applies missing versions in order
```

Each migration runs in a transaction — if the SQL fails, the version isn't recorded and can be retried. Applied versions are tracked in a `schema_migrations` table:

```
┌─────────┬──────────────┬─────────────────────┐
│ version │ name         │ applied_at          │
├─────────┼──────────────┼─────────────────────┤
│ 1       │ create_users │ 2026-03-10 12:00:00 │
│ 2       │ add_email    │ 2026-03-10 12:00:00 │
└─────────┴──────────────┴─────────────────────┘
```

### WAL Mode

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

WAL (Write-Ahead Logging) allows concurrent readers while a writer is active. This is critical for web applications where HTTP requests read data while LiveView events write it. Foreign keys are enabled for referential integrity.

### Guestbook Architecture

```
Browser Tab A                  Server                    SQLite
    │                            │                         │
    │──bv-submit "sign"─────────>│                         │
    │                            │──INSERT INTO entries──-->│
    │                            │<──{ lastInsertRowid }───│
    │                            │──SELECT WHERE id = ?──->│
    │                            │<──entry row─────────────│
    │                            │                         │
    │                            │──PubSub broadcast───┐   │
    │<──render (new entry)───────│                     │   │
    │                            │                     │   │
Browser Tab B                   │<─────────────────────┘   │
    │<──render (new entry)───────│                         │
```

## The Code

### `src/blaze/database.ts` (new)

```typescript
import BetterSqlite3 from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export class Database {
  readonly db: BetterSqlite3.Database;
  readonly name: string;

  constructor(path: string, name: string = "default") {
    this.name = name;
    this.db = new BetterSqlite3(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  migrate(migrations: Migration[]): { applied: string[] } {
    this.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied: string[] = [];
    const existing = new Set(
      this.all<{ version: number }>("SELECT version FROM schema_migrations")
        .map((r) => r.version),
    );

    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sorted) {
      if (existing.has(m.version)) continue;

      this.db.transaction(() => {
        this.exec(m.up);
        this.run(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
          m.version, m.name,
        );
      })();

      applied.push(`${m.version}_${m.name}`);
    }

    return { applied };
  }

  rollback(migrations: Migration[], version: number): boolean {
    const m = migrations.find((m) => m.version === version);
    if (!m) return false;

    const exists = this.get(
      "SELECT version FROM schema_migrations WHERE version = ?",
      version,
    );
    if (!exists) return false;

    this.db.transaction(() => {
      this.exec(m.down);
      this.run("DELETE FROM schema_migrations WHERE version = ?", version);
    })();

    return true;
  }

  close(): void {
    this.db.close();
  }
}
```

Key differences from the Bun version:
- `better-sqlite3`'s `run()` returns `{ changes, lastInsertRowid }` directly — no need for separate `SELECT changes()` / `SELECT last_insert_rowid()` queries
- PRAGMAs use `db.pragma()` instead of `db.exec("PRAGMA ...")`
- Transaction API is identical: `db.transaction(fn)()`

### `src/my_app/guestbook_live.ts` (new)

A real-time guestbook that:
1. Creates `guestbook.db` with an `entries` table on first run
2. Loads existing entries in `mount()`
3. Inserts new entries via `bv-submit` form event
4. Broadcasts to all tabs via PubSub
5. Escapes user input to prevent XSS

The database initializes at module level — migrations run once when the server starts.

## Try It Out

```bash
npm run dev
```

1. Visit `http://localhost:4001/guestbook`
2. Enter your name and a message, click **Sign**
3. Open another tab at the same URL — entries sync in real-time
4. **Restart the server** — entries persist! (stored in `guestbook.db`)
5. Click **Clear All** to wipe entries across all tabs

## File Checklist

| File | Status | Description |
|------|--------|-------------|
| `src/blaze/database.ts` | **New** | SQLite wrapper with migrations |
| `src/my_app/guestbook_live.ts` | **New** | Real-time guestbook demo |
| `src/app.ts` | Modified | Added `/guestbook` route + landing page link |
| `package.json` | Modified | Added `better-sqlite3` dependency |

## What's Next

**Step 32 — CSRF Protection:** Per-session tokens with XOR masking to protect form submissions from cross-site request forgery.

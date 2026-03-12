/**
 * GuestbookLive -- SQLite-backed guestbook using LiveView.
 *
 * Demonstrates:
 * - Database creation and migration
 * - INSERT and SELECT queries with parameterized SQL
 * - Real-time updates via PubSub when new entries are added
 * - Data persists across server restarts
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";
import { Database, type Migration } from "../blaze/database.js";
import * as PubSub from "../blaze/pub_sub.js";

const TOPIC = "guestbook:entries";

// Initialize database and run migrations
const db = new Database("guestbook.db", "guestbook");

const migrations: Migration[] = [
  {
    version: 1,
    name: "create_entries",
    up: `CREATE TABLE entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    down: "DROP TABLE entries",
  },
];

const { applied } = db.migrate(migrations);
if (applied.length > 0) {
  console.log(`Guestbook migrations applied: ${applied.join(", ")}`);
}

interface Entry {
  id: number;
  name: string;
  message: string;
  created_at: string;
}

export class GuestbookLive extends LiveView {
  mount(socket: LiveViewSocket) {
    const entries = db.all<Entry>(
      "SELECT * FROM entries ORDER BY id DESC LIMIT 50",
    );

    socket.assign({
      entries,
      name: "",
      message: "",
    });

    socket.subscribe(TOPIC);
  }

  handleEvent(event: string, params: Record<string, unknown>, socket: LiveViewSocket) {
    switch (event) {
      case "submit": {
        const name = ((params.name as string) ?? "").trim();
        const message = ((params.message as string) ?? "").trim();

        if (name && message) {
          const { lastInsertRowid } = db.run(
            "INSERT INTO entries (name, message) VALUES (?, ?)",
            name,
            message,
          );

          const entry = db.get<Entry>(
            "SELECT * FROM entries WHERE id = ?",
            lastInsertRowid,
          );

          if (entry) {
            // Update sender's own list (broadcast excludes sender)
            const entries = [entry, ...(socket.assigns.entries as Entry[])].slice(0, 50);
            socket.assign({ entries });
            socket.broadcast(TOPIC, { type: "new_entry", entry });
          }
        }

        socket.assign({ name: "", message: "" });
        break;
      }
      case "clear_all": {
        db.run("DELETE FROM entries");
        socket.broadcast(TOPIC, { type: "cleared" });
        socket.assign({ entries: [] });
        break;
      }
    }
  }

  handleInfo(message: unknown, socket: LiveViewSocket) {
    const msg = message as { type: string; entry?: Entry };
    if (msg.type === "new_entry" && msg.entry) {
      const entries = [msg.entry, ...(socket.assigns.entries as Entry[])].slice(0, 50);
      socket.assign({ entries });
    } else if (msg.type === "cleared") {
      socket.assign({ entries: [] });
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const entries = assigns.entries as Entry[];

    let entriesHtml = "";
    for (const e of entries) {
      entriesHtml += `<div style="padding:0.6rem 0.8rem; margin:0.3rem 0; background:#f8f8f8;
                            border-radius:6px; border-left:3px solid #36c;">
        <strong>${escapeHtml(e.name)}</strong>
        <span style="color:#999; font-size:0.8rem; float:right;">${e.created_at}</span>
        <p style="margin:0.3rem 0 0;">${escapeHtml(e.message)}</p>
      </div>`;
    }

    return bv`
      <h1>Guestbook</h1>
      <p style="color:#666;">SQLite-backed guestbook with real-time updates across tabs.</p>

      <form bv-submit="submit" style="margin:1rem 0; display:flex; gap:0.5rem; flex-wrap:wrap;">
        <input type="text" name="name" placeholder="Your name"
               style="padding:0.5rem; font-size:1rem; border:1px solid #ccc; border-radius:4px; flex:1; min-width:120px;" />
        <input type="text" name="message" placeholder="Leave a message..."
               style="padding:0.5rem; font-size:1rem; border:1px solid #ccc; border-radius:4px; flex:3; min-width:200px;" />
        <button type="submit" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#36c; color:white; border:none; border-radius:4px;">
          Sign
        </button>
      </form>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2>Entries (${String(entries.length)})</h2>
        <button bv-click="clear_all" style="padding:0.3rem 0.8rem; font-size:0.85rem; cursor:pointer;
                background:#dc3545; color:white; border:none; border-radius:4px;">
          Clear All
        </button>
      </div>

      ${entriesHtml || '<p style="color:#999;">No entries yet. Be the first to sign!</p>'}

      <div class="nav-links" style="margin-top:1rem;">
        <a bv-navigate="/counter" href="/counter">Counter</a>
        <a bv-navigate="/presence" href="/presence">Presence</a>
        <a bv-navigate="/streams" href="/streams">Streams</a>
      </div>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

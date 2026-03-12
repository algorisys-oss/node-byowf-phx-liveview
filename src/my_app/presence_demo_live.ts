/**
 * Presence Demo LiveView -- "Who's Online" tracker.
 *
 * Each connected tab gets a random username and color.
 * The user list updates in real time as tabs open/close.
 *
 * Pattern: trackPresence in mount(), listen for presence_diff
 * in handleInfo(), re-render on changes.
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

const TOPIC = "presence:lobby";

const NAMES = [
  "Phoenix", "Blaze", "Ember", "Flame", "Spark",
  "Flare", "Ignite", "Inferno", "Torch", "Beacon",
  "Nova", "Comet", "Stellar", "Orbit", "Pulsar",
];

const COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f39c12",
  "#1abc9c", "#e67e22", "#e91e63", "#00bcd4", "#8bc34a",
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export class PresenceDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    const name = randomPick(NAMES);
    const color = randomPick(COLORS);
    const id = `${name}-${Math.random().toString(36).slice(2, 6)}`;

    socket.subscribe(TOPIC);
    socket.trackPresence(TOPIC, id, {
      name,
      color,
      joined_at: new Date().toLocaleTimeString(),
    });

    socket.assign({
      myId: id,
      myName: name,
      myColor: color,
      users: socket.listPresences(TOPIC),
    });
  }

  handleEvent(
    _event: string,
    _params: Record<string, unknown>,
    _socket: LiveViewSocket,
  ): void {
    // No user events in this demo
  }

  handleInfo(message: unknown, socket: LiveViewSocket): void {
    const msg = message as { type?: string; diff?: unknown };
    if (msg.type === "presence_diff") {
      // Refresh the full user list on any join/leave
      socket.assign({ users: socket.listPresences(TOPIC) });
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const users = assigns.users as Record<string, { name: string; color: string; joined_at: string }>;
    const myId = assigns.myId as string;
    const myColor = assigns.myColor as string;

    const userEntries = Object.entries(users);
    const userListHtml = userEntries
      .map(([id, meta]) => {
        const isMe = id === myId ? " (you)" : "";
        return `<li style="padding: 0.4rem 0;">
          <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${meta.color}; margin-right:0.5rem; vertical-align:middle;"></span>
          <strong>${meta.name}</strong>${isMe}
          <span style="color:#999; font-size:0.85em; margin-left:0.5rem;">joined ${meta.joined_at}</span>
        </li>`;
      })
      .join("");

    return bv`
      <h1>Who's Online</h1>
      <p style="font-size: 0.9rem; color: #666;">
        You are <strong style="color: ${myColor};">${assigns.myName}</strong>.
        Open this page in multiple tabs to see presence tracking in action.
      </p>
      <h2>Connected Users (${String(userEntries.length)})</h2>
      <ul style="list-style: none; padding: 0;">
        ${userListHtml}
      </ul>
      <p style="color: #888; font-size: 0.85rem; margin-top: 1.5rem;">
        Close a tab → user disappears. Open a new tab → user appears.
        All updates happen in real time via PubSub presence diffs.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}

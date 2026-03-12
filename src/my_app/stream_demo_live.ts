/**
 * StreamDemoLive -- Demonstrates LiveView Streams with upsert and limit.
 *
 * Features:
 * - Stream with limit: 20 (auto-prunes when exceeded)
 * - Prepend/append operations
 * - Upsert: "Update Latest" modifies an existing item in-place
 * - Manual delete via bv-value
 * - Event count tracked separately from stream
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

let nextId = 1;

function makeEvent(text: string, type: string = "info") {
  return {
    id: String(nextId++),
    text,
    type,
    time: new Date().toLocaleTimeString(),
  };
}

const TYPE_COLORS: Record<string, string> = {
  info: "#e45",
  warning: "#e90",
  success: "#2a2",
};

function renderEvent(event: { id: string; text: string; type: string; time: string }) {
  const color = TYPE_COLORS[event.type] || "#e45";
  return `<div id="events-${event.id}" style="padding:0.4rem 0.6rem; margin:0.2rem 0;
                background:${event.type === "warning" ? "#fff8e0" : "#f8f8f8"}; border-radius:4px; border-left:3px solid ${color};
                display:flex; justify-content:space-between; align-items:center;">
          <span><strong>#${event.id}</strong> ${event.text}</span>
          <span style="display:flex; align-items:center; gap:0.5rem;">
            <span style="color:#999; font-size:0.8rem;">${event.time}</span>
            <button bv-click="delete" bv-value="${event.id}"
                    style="padding:0.1rem 0.4rem; font-size:0.75rem; background:#c33;
                           color:white; border:none; border-radius:3px; cursor:pointer;">x</button>
          </span>
        </div>`;
}

export class StreamDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    const initial = [
      makeEvent("Stream initialized"),
      makeEvent("Welcome to LiveView Streams"),
      makeEvent("Events appear here in real-time"),
    ];

    socket.assign({ count: initial.length, latestId: String(nextId - 1) });
    socket.stream("events", initial, {
      render: renderEvent,
      limit: 20,
    });
  }

  handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const count = socket.assigns.count as number;

    switch (event) {
      case "add": {
        const evt = makeEvent(`User event #${count + 1}`);
        socket.assign({ count: count + 1, latestId: evt.id });
        socket.streamInsert("events", evt, { at: 0 });
        break;
      }
      case "add_bottom": {
        const evt = makeEvent(`Appended event #${count + 1}`);
        socket.assign({ count: count + 1, latestId: evt.id });
        socket.streamInsert("events", evt);
        break;
      }
      case "update_latest": {
        const latestId = socket.assigns.latestId as string;
        if (latestId) {
          const updated = {
            id: latestId,
            text: "UPDATED \u2014 modified in-place via upsert",
            type: "warning",
            time: new Date().toLocaleTimeString(),
          };
          socket.streamInsert("events", updated);
        }
        break;
      }
      case "delete": {
        const id = params.value as string;
        socket.streamDelete("events", { id });
        socket.assign({ count: Math.max(0, count - 1) });
        break;
      }
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const count = assigns.count as number;
    return bv`
      <h1>LiveView Streams</h1>
      <p>Events in stream: <strong>${count}</strong> <span style="color:#999; font-size:0.85rem;">(limit: 20)</span></p>
      <p>
        <button bv-click="add" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#e45; color:white; border:none; border-radius:4px;">
          Prepend Event
        </button>
        <button bv-click="add_bottom" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#36c; color:white; border:none; border-radius:4px; margin-left:0.5rem;">
          Append Event
        </button>
        <button bv-click="update_latest" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#e90; color:white; border:none; border-radius:4px; margin-left:0.5rem;">
          Update Latest
        </button>
      </p>
      <div bv-stream="events" style="max-height:400px; overflow-y:auto; border:1px solid #ddd;
                                      border-radius:6px; padding:0.5rem;"></div>
      <p style="color: #888; font-size: 0.85rem; margin-top: 1rem;">
        Streams bypass the template — items are inserted/deleted directly in the DOM.
        Limit: 20 items (oldest pruned automatically). "Update Latest" upserts in-place via morphdom.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a>
      </div>
    `;
  }
}

/**
 * TempAssignsDemoLive -- Demonstrates Temporary Assigns with Streams.
 *
 * Messages are streamed to the DOM but reset from server memory after
 * each render. The "Server Held" counter shows the batch size then
 * drops to 0, proving the server isn't accumulating data.
 *
 * Pattern: stream handles DOM persistence, temporary assigns handle
 * server-side memory cleanup.
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

let nextMsgId = 1;

function renderMessage(msg: { id: string; text: string; time: string }) {
  return `<div id="msgs-${msg.id}" style="padding:0.3rem 0.6rem; margin:0.15rem 0;
                background:#f8f8f8; border-radius:4px; border-left:3px solid #36c;
                display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
          <span>${msg.text}</span>
          <span style="color:#999; font-size:0.8rem;">${msg.time}</span>
        </div>`;
}

export class TempAssignsDemoLive extends LiveView {
  // messages resets to [] after each render — server doesn't accumulate
  temporary_assigns = { messages: [] as any[] };

  mount(socket: LiveViewSocket): void {
    const initial = [
      { id: String(nextMsgId++), text: "System: temporary assigns demo started", time: new Date().toLocaleTimeString() },
      { id: String(nextMsgId++), text: "System: messages reset after each render", time: new Date().toLocaleTimeString() },
    ];

    socket.assign({
      messages: initial,
      totalSent: initial.length,
      serverHeld: initial.length,
    });

    socket.stream("msgs", initial, {
      render: renderMessage,
      limit: 50,
    });
  }

  handleEvent(
    event: string,
    _params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    switch (event) {
      case "send": {
        const total = (socket.assigns.totalSent as number) + 1;
        const msg = {
          id: String(nextMsgId++),
          text: `Message #${total}`,
          time: new Date().toLocaleTimeString(),
        };
        socket.assign({
          messages: [msg],
          totalSent: total,
          serverHeld: 1,
        });
        socket.streamInsert("msgs", msg, { at: 0 });
        break;
      }
      case "send_batch": {
        const count = 10;
        const total = (socket.assigns.totalSent as number) + count;
        const msgs = [];
        for (let i = 0; i < count; i++) {
          const msg = {
            id: String(nextMsgId++),
            text: `Batch message #${total - count + i + 1}`,
            time: new Date().toLocaleTimeString(),
          };
          msgs.push(msg);
          socket.streamInsert("msgs", msg, { at: 0 });
        }
        socket.assign({
          messages: msgs,
          totalSent: total,
          serverHeld: count,
        });
        break;
      }
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const totalSent = assigns.totalSent as number;
    const serverHeld = assigns.serverHeld as number;
    const messages = assigns.messages as any[];

    return bv`
      <h1>Temporary Assigns</h1>

      <div style="display:flex; gap:2rem; margin:1rem 0;">
        <div style="text-align:center; padding:1rem; background:#f0f9ff; border-radius:8px;">
          <div style="font-size:2rem; font-weight:bold; color:#36c;">${totalSent}</div>
          <div style="font-size:0.85rem; color:#666;">Total Sent</div>
        </div>
        <div style="text-align:center; padding:1rem; background:#fff0f0; border-radius:8px;">
          <div style="font-size:2rem; font-weight:bold; color:#c33;">${serverHeld}</div>
          <div style="font-size:0.85rem; color:#666;">Server Held</div>
          <div style="font-size:0.75rem; color:#999;">(resets to 0 after render)</div>
        </div>
        <div style="text-align:center; padding:1rem; background:#f0fff0; border-radius:8px;">
          <div style="font-size:2rem; font-weight:bold; color:#2a2;">${messages.length}</div>
          <div style="font-size:0.85rem; color:#666;">Current Batch</div>
          <div style="font-size:0.75rem; color:#999;">(temporary assign)</div>
        </div>
      </div>

      <p>
        <button bv-click="send" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#36c; color:white; border:none; border-radius:4px;">
          Send Message
        </button>
        <button bv-click="send_batch" style="padding:0.5rem 1rem; font-size:1rem; cursor:pointer;
                background:#e45; color:white; border:none; border-radius:4px; margin-left:0.5rem;">
          Send 10 Messages
        </button>
      </p>

      <div bv-stream="msgs" style="max-height:350px; overflow-y:auto; border:1px solid #ddd;
                                    border-radius:6px; padding:0.5rem;"></div>

      <p style="color: #888; font-size: 0.85rem; margin-top: 1rem;">
        <strong>How it works:</strong> "Server Held" shows how many messages the server
        holds during this render. After render, <code>messages</code> resets to <code>[]</code>
        (temporary assign), so the server stays lean. The DOM keeps all messages via streams.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/components" bv-navigate="/components">Components</a>
      </div>
    `;
  }
}

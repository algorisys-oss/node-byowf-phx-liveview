/**
 * Shared Counter LiveView -- Demonstrates PubSub broadcasting.
 *
 * Every connected client sees the same count. When one tab clicks
 * increment, all other tabs update in real time via PubSub.
 *
 * Pattern: subscribe in mount(), broadcast in handleEvent(),
 * receive in handleInfo().
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

const TOPIC = "shared_counter:lobby";

export class SharedCounterLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({ count: 0 });
    socket.subscribe(TOPIC);
  }

  handleEvent(
    event: string,
    _params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const count = socket.assigns.count as number;

    switch (event) {
      case "increment":
        socket.assign({ count: count + 1 });
        socket.broadcast(TOPIC, { count_updated: count + 1 });
        break;
      case "decrement":
        socket.assign({ count: count - 1 });
        socket.broadcast(TOPIC, { count_updated: count - 1 });
        break;
      case "reset":
        socket.assign({ count: 0 });
        socket.broadcast(TOPIC, { count_updated: 0 });
        break;
    }
  }

  handleInfo(message: unknown, socket: LiveViewSocket): void {
    const msg = message as { count_updated?: number };
    if (msg.count_updated !== undefined) {
      socket.assign({ count: msg.count_updated });
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    return bv`
      <h1>Shared Counter</h1>
      <p style="font-size: 1.5rem; color: #333;">
        All connected tabs share this count: <strong>${assigns.count}</strong>
      </p>
      <div>
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        Open this page in multiple tabs — clicks sync across all of them.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}

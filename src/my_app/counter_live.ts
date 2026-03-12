/**
 * Counter LiveView -- A real-time counter that updates over WebSocket.
 *
 * Demonstrates the LiveView lifecycle with efficient diffing:
 * 1. mount() sets initial count to 0
 * 2. handleEvent() responds to increment/decrement/reset
 * 3. render() returns a Rendered object via bv`...` tagged template
 *
 * Only the count value (a single dynamic) is sent over the wire
 * on each update -- not the entire HTML string.
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

export class CounterLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({ count: 0 });
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
        break;
      case "decrement":
        socket.assign({ count: count - 1 });
        break;
      case "reset":
        socket.assign({ count: 0 });
        break;
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    return bv`
      <h1>Live Counter</h1>
      <p style="font-size: 3rem; font-weight: bold; margin: 1rem 0;">${assigns.count}</p>
      <div>
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <p style="color: #888; margin-top: 1rem; font-size: 0.9rem;">
        Click the buttons — updates happen over WebSocket, no page reload.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}

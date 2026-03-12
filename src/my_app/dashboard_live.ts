/**
 * DashboardLive -- A dashboard with multiple dynamic values.
 *
 * Demonstrates fine-grained diffing with nested bv`` templates:
 * - statCard() returns a Rendered object (3 dynamics each)
 * - Parent template flattens all child dynamics into one flat list
 * - On increment, only 2 of 10 dynamics are sent over the wire
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

function statCard(label: string, value: unknown, color: string): Rendered {
  return bv`
    <div style="display:inline-block; background:${color}; color:white;
                padding:1rem 1.5rem; border-radius:8px; margin:0.5rem; min-width:120px; text-align:center;">
      <div style="font-size:0.8rem; opacity:0.8;">${label}</div>
      <div style="font-size:2rem; font-weight:bold;">${value}</div>
    </div>`;
}

export class DashboardLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({
      count: 0,
      clicks: 0,
      message: "Welcome!",
    });
  }

  handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const { count, clicks } = socket.assigns as { count: number; clicks: number };

    switch (event) {
      case "increment":
        socket.assign({ count: count + 1, clicks: clicks + 1 });
        break;
      case "decrement":
        socket.assign({ count: count - 1, clicks: clicks + 1 });
        break;
      case "reset":
        socket.assign({ count: 0, clicks: clicks + 1, message: "Reset!" });
        break;
      case "update_message":
        socket.assign({ message: params.message || "" });
        break;
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const countCard = statCard("Counter", assigns.count, "#e45");
    const clickCard = statCard("Total Clicks", assigns.clicks, "#36c");
    const msgCard = statCard("Message", assigns.message, "#2a9");

    return bv`
      <h1>Dashboard</h1>
      <div style="margin: 1rem 0;">
        ${countCard}
        ${clickCard}
        ${msgCard}
      </div>
      <div style="margin: 1rem 0;">
        <button bv-click="decrement">−</button>
        <button bv-click="reset">Reset</button>
        <button bv-click="increment">+</button>
      </div>
      <div style="margin: 1rem 0;">
        <label>Message: </label>
        <input bv-change="update_message" name="message" value="${assigns.message}"
               style="padding:0.4rem; font-size:1rem; border:1px solid #ccc; border-radius:4px;">
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        Each stat card is a nested bv\`\` template. Only changed values are sent as sparse diffs.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}

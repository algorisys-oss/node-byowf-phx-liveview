/**
 * ComponentsDemoLive -- Demonstrates LiveComponents.
 *
 * Shows multiple instances of ToggleButton and NotificationBadge,
 * each with independent state and event handling.
 * Parent view also has its own state (click counter).
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";
import { component } from "../blaze/live_component.js";
import { ToggleButton } from "./components/toggle_button.js";
import { NotificationBadge } from "./components/notification_badge.js";

export class ComponentsDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({ parentClicks: 0 });
  }

  handleEvent(
    event: string,
    _params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    if (event === "parent_click") {
      socket.assign({
        parentClicks: (socket.assigns.parentClicks as number) + 1,
      });
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const alerts = component(assigns, NotificationBadge, {
      id: "alerts",
      label: "Alerts",
      count: 3,
    });
    const messages = component(assigns, NotificationBadge, {
      id: "messages",
      label: "Messages",
      count: 7,
    });
    const darkMode = component(assigns, ToggleButton, {
      id: "dark-mode",
      label: "Dark Mode",
    });
    const notifications = component(assigns, ToggleButton, {
      id: "notifications",
      label: "Notifications",
      initialOn: true,
    });
    const sound = component(assigns, ToggleButton, {
      id: "sound",
      label: "Sound",
    });

    return bv`
      <h1>LiveComponents Demo</h1>

      <h2>Notification Badges</h2>
      <p>Each badge is an independent component with its own dismiss/restore state:</p>
      <div>${alerts}</div>
      <div>${messages}</div>

      <h2>Toggle Buttons</h2>
      <p>Each toggle maintains its own on/off state:</p>
      <div>${darkMode}</div>
      <div>${notifications}</div>
      <div>${sound}</div>

      <h2>Parent View State</h2>
      <p>The parent LiveView has its own state separate from components:</p>
      <p>Parent clicks: <strong>${assigns.parentClicks}</strong></p>
      <button bv-click="parent_click">Parent Click</button>

      <p style="color: #888; font-size: 0.85rem; margin-top: 1.5rem;">
        Component events are namespaced (e.g., "alerts:dismiss").
        Each component manages its own state independently.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/hooks" bv-navigate="/hooks">Hooks</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}

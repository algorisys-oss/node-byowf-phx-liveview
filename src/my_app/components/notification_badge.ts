/**
 * NotificationBadge -- A dismissable notification counter.
 *
 * Props: label (string), count (number)
 * State: dismissed (boolean, defaults to false)
 * Events: "dismiss", "restore"
 */

import { LiveComponent } from "../../blaze/live_component.js";

export class NotificationBadge extends LiveComponent {
  mount(assigns: Record<string, unknown>): void {
    if (assigns.dismissed === undefined) assigns.dismissed = false;
  }

  handleEvent(
    event: string,
    _params: Record<string, unknown>,
    assigns: Record<string, unknown>,
  ): void {
    switch (event) {
      case "dismiss":
        assigns.dismissed = true;
        break;
      case "restore":
        assigns.dismissed = false;
        break;
    }
  }

  render(assigns: Record<string, unknown>): string {
    const label = assigns.label as string;
    const count = assigns.count as number;
    const dismissed = assigns.dismissed as boolean;

    if (dismissed) {
      return `<div style="display:inline-block; padding:0.5rem 1rem; margin:0.5rem;
                          background:#f4f4f4; border-radius:6px; color:#999;">
        ${label}: dismissed
        <button bv-click="restore" style="margin-left:0.5rem; padding:0.2rem 0.5rem;
                font-size:0.8rem; background:#36c; color:white; border:none;
                border-radius:4px; cursor:pointer;">Restore</button>
      </div>`;
    }

    const bg = count > 0 ? "#e45" : "#2a9";
    return `<div style="display:inline-block; padding:0.5rem 1rem; margin:0.5rem;
                        background:#f8f8f8; border-radius:6px;">
      ${label}: <span style="background:${bg}; color:white; padding:0.1rem 0.5rem;
                             border-radius:10px; font-size:0.85rem;">${count}</span>
      <button bv-click="dismiss" style="margin-left:0.5rem; padding:0.2rem 0.5rem;
              font-size:0.8rem; background:#888; color:white; border:none;
              border-radius:4px; cursor:pointer;">Dismiss</button>
    </div>`;
  }
}

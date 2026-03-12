/**
 * ToggleButton -- A stateful toggle component.
 *
 * Props: label (string), initialOn? (boolean)
 * State: on (boolean, defaults to false or initialOn)
 * Events: "toggle"
 */

import { LiveComponent } from "../../blaze/live_component.js";

export class ToggleButton extends LiveComponent {
  mount(assigns: Record<string, unknown>): void {
    assigns.on = assigns.initialOn ?? false;
  }

  handleEvent(
    event: string,
    _params: Record<string, unknown>,
    assigns: Record<string, unknown>,
  ): void {
    if (event === "toggle") {
      assigns.on = !assigns.on;
    }
  }

  render(assigns: Record<string, unknown>): string {
    const on = assigns.on as boolean;
    const label = assigns.label as string;
    const bg = on ? "#2a9" : "#ccc";
    const text = on ? "ON" : "OFF";

    return `<div style="display:inline-flex; align-items:center; gap:0.5rem; margin:0.5rem 0;">
      <span>${label}</span>
      <button bv-click="toggle"
              style="padding:0.3rem 0.8rem; background:${bg}; color:white;
                     border:none; border-radius:12px; cursor:pointer; font-size:0.85rem;">
        ${text}
      </button>
    </div>`;
  }
}

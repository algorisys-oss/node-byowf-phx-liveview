/**
 * HooksDemoLive -- Demonstrates JS Hooks with LiveView.
 *
 * Two hooks in action:
 * 1. CopyToClipboard — copies text to clipboard, reports result to server
 * 2. LocalTime — client-side clock that can push time to server
 *
 * Hook events arrive via pushEvent() and are handled in handleEvent()
 * exactly like regular bv-click events.
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

export class HooksDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.assign({
      hookEvents: [] as string[],
      copyText: "Hello from Blaze hooks!",
    });
  }

  handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void {
    const events = (socket.assigns.hookEvents as string[]).slice(0, 4);

    switch (event) {
      case "clipboard_result": {
        const status = params.success === "true" ? "copied" : "failed";
        const text = (params.text as string) || "";
        events.unshift(`Clipboard: ${status}${text ? " \u2014 " + text : ""}`);
        socket.assign({ hookEvents: events });
        break;
      }
      case "local_time": {
        events.unshift(`Client time: ${params.time}`);
        socket.assign({ hookEvents: events });
        break;
      }
      case "update_copy_text": {
        socket.assign({ copyText: params.text || "" });
        break;
      }
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const events = assigns.hookEvents as string[];
    const copyText = assigns.copyText as string;

    const eventList = events.length > 0
      ? events.map((e) => `<li>${e}</li>`).join("")
      : "<li style=\"color: #999;\">No hook events yet — try the buttons below</li>";

    return bv`
      <h1>JS Hooks Demo</h1>

      <h2>Hook Events Log</h2>
      <ul style="background: #f5f5f5; padding: 1rem 1rem 1rem 2rem; border-radius: 4px; min-height: 2rem;">
        ${eventList}
      </ul>

      <h2>CopyToClipboard Hook</h2>
      <p>Click the button to copy text to clipboard. The hook reports success/failure to the server.</p>
      <div style="margin: 0.5rem 0;">
        <label>Text to copy: </label>
        <input bv-change="update_copy_text" name="text" value="${copyText}"
               style="padding: 0.4rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; width: 300px;">
      </div>
      <button id="copy-btn" bv-hook="CopyToClipboard" data-text="${copyText}"
              style="background: #2563eb; color: white; border: none; border-radius: 4px; padding: 0.5rem 1.5rem; cursor: pointer;">
        Copy to Clipboard
      </button>

      <h2>LocalTime Hook</h2>
      <p>A client-side clock that updates every second. "Send Time" pushes the time to the server.</p>
      <div id="local-time" bv-hook="LocalTime"
           style="background: #f0f9ff; padding: 1rem; border-radius: 4px; display: inline-block;">
        <span style="font-size: 1.5rem; font-weight: bold;" data-role="display">Loading...</span>
        <button data-role="send"
                style="margin-left: 1rem; background: #059669; color: white; border: none; border-radius: 4px; padding: 0.4rem 1rem; cursor: pointer;">
          Send Time to Server
        </button>
      </div>

      <p style="color: #888; font-size: 0.85rem; margin-top: 1.5rem;">
        Hooks bridge client-side JavaScript with server-side LiveView state.
        The clock runs entirely in the browser — only "Send Time" talks to the server.
      </p>
      <div style="margin-top: 1rem;">
        <a href="/counter" bv-navigate="/counter">Counter</a> |
        <a href="/dashboard" bv-navigate="/dashboard">Dashboard</a> |
        <a href="/shared-counter" bv-navigate="/shared-counter">Shared Counter</a> |
        <a href="/components" bv-navigate="/components">Components</a> |
        <a href="/streams" bv-navigate="/streams">Streams</a>
      </div>
    `;
  }
}

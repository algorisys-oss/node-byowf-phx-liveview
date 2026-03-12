/**
 * Blaze LiveView -- Server-rendered real-time views over WebSocket.
 *
 * Equivalent to Phoenix.LiveView in the Elixir version.
 *
 * A LiveView is a class instance per WebSocket connection. The server:
 * 1. Calls mount() to set initial state (assigns)
 * 2. Calls render() to produce HTML from assigns
 * 3. Sends HTML to the client over WebSocket
 * 4. Receives events from the client (clicks, form submissions)
 * 5. Calls handleEvent() to update assigns
 * 6. Re-renders and sends updated HTML
 *
 * No page reloads -- all updates happen over a persistent WebSocket connection.
 */

import type { Rendered } from "./rendered.js";
import type { StreamInitOpts, StreamInsertOpts } from "./stream.js";
import type { AllowUploadOpts, UploadConfig, UploadEntry } from "./upload.js";
import type { PresenceMeta } from "./presence.js";

/**
 * LiveViewSocket -- The interface a LiveView uses to manage state.
 *
 * Equivalent to Phoenix.LiveView.Socket. Holds the current assigns
 * and provides assign() to update them.
 */
export interface LiveViewSocket {
  /** Current state (key-value pairs) */
  assigns: Record<string, unknown>;

  /** Merge new values into assigns */
  assign(newAssigns: Record<string, unknown>): void;

  /** Subscribe this LiveView to a PubSub topic */
  subscribe(topic: string): void;

  /** Broadcast a message to all other subscribers of a topic */
  broadcast(topic: string, message: unknown): void;

  /** Navigate the client to a different LiveView path (server-initiated) */
  pushRedirect(path: string): void;

  /** Initialize a stream for efficient list rendering */
  stream(name: string, initialItems: any[], opts: StreamInitOpts): void;

  /** Insert (or upsert) an item into a stream */
  streamInsert(name: string, item: any, opts?: StreamInsertOpts): void;

  /** Delete an item from a stream */
  streamDelete(name: string, item: any): void;

  /** Configure a file upload input */
  allowUpload(name: string, opts?: AllowUploadOpts): void;

  /** Process completed uploads, callback receives each entry */
  consumeUploadedEntries(
    name: string,
    callback: (entry: UploadEntry) => Promise<any> | any,
  ): Promise<any[]>;

  /** Read upload state for templates */
  getUploads(): Record<string, UploadConfig>;

  /** Track this connection's presence in a topic */
  trackPresence(topic: string, key: string, meta: PresenceMeta): void;

  /** List all presences for a topic */
  listPresences(topic: string): Record<string, PresenceMeta>;
}

/**
 * LiveView -- Abstract base class for real-time views.
 *
 * Subclass this and implement mount(), handleEvent(), and render().
 * Each WebSocket connection gets its own LiveView instance.
 */
export abstract class LiveView {
  /**
   * Declare assigns that reset to a default value after each render.
   * Override in subclass: `temporary_assigns = { messages: [] }`
   * Prevents large data from accumulating in memory across renders.
   */
  temporary_assigns: Record<string, unknown> = {};

  /**
   * Called once when the WebSocket connects.
   * Set initial assigns here.
   */
  abstract mount(socket: LiveViewSocket): void | Promise<void>;

  /**
   * Called when the client sends an event (e.g., button click).
   * Update assigns based on the event and params.
   */
  abstract handleEvent(
    event: string,
    params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): void | Promise<void>;

  /**
   * Called when a PubSub broadcast is received on a subscribed topic.
   * Update assigns based on the message. Optional -- only needed for
   * views that use PubSub.
   */
  handleInfo?(
    message: unknown,
    socket: LiveViewSocket,
  ): void | Promise<void>;

  /**
   * Return HTML string or Rendered object based on current assigns.
   * Called after mount() and after each handleEvent().
   *
   * Return a string for simple rendering (full HTML sent each time).
   * Return a Rendered object (via bv`...` tagged template) for
   * efficient diffing -- only changed dynamics are sent over the wire.
   */
  abstract render(assigns: Record<string, unknown>): string | Rendered;
}

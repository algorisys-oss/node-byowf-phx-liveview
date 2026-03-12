/**
 * Blaze LiveHandler -- Manages WebSocket connections for LiveViews.
 *
 * Each WebSocket connection is associated with a LiveView instance.
 * The handler orchestrates the lifecycle:
 *   open → mount() → render() → send mount (statics + dynamics)
 *   message → handleEvent() → render() → send diff (changed dynamics only)
 *   close → cleanup (unsubscribe from PubSub)
 *
 * Messages use a JSON protocol:
 *   Client → Server: { type: "event", event: "increment", params: {} }
 *   Server → Client (mount):  { type: "mount", statics: [...], dynamics: [...] }
 *   Server → Client (diff):   { type: "diff", dynamics: { "0": "1" } }
 *   Server → Client (render): { type: "render", html: "..." } (fallback for string renders)
 *
 * PubSub broadcasts trigger handleInfo() → re-render → send diff,
 * using the same sendUpdate() helper as handleEvent responses.
 */

import type { WebSocket } from "uWebSockets.js";
import { appendFile, unlink } from "node:fs/promises";
import { LiveView, type LiveViewSocket } from "./live_view.js";
import { isRendered, diffDynamics } from "./rendered.js";
import * as PubSub from "./pub_sub.js";
import * as Presence from "./presence.js";
import * as Stream from "./stream.js";
import * as Upload from "./upload.js";
import { incrementConnections, decrementConnections } from "./health.js";
import type { ComponentEntry } from "./live_component.js";

/** Per-connection data stored in ws.getUserData() */
export interface LiveConnection {
  path: string;
  view?: LiveView;
  socket?: LiveViewSocket;
  /** Previous dynamics for diffing (only set when render() returns Rendered) */
  prevDynamics?: string[];
  /** PubSub subscriber callback for this connection */
  subscriber?: PubSub.Subscriber;
}

/** LiveView class constructor type */
export type LiveViewClass = new () => LiveView;

/** Get a JSON map of all registered live routes (for client-side navigation). */
export function getLiveRoutesMap(liveRoutes: Map<string, LiveViewClass>): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const routePath of liveRoutes.keys()) {
    map[routePath] = true;
  }
  return map;
}

/** Get or initialize the uploads map on assigns. */
function getUploads(assigns: Record<string, unknown>): Record<string, Upload.UploadConfig> {
  if (!assigns.__uploads__) assigns.__uploads__ = {};
  return assigns.__uploads__ as Record<string, Upload.UploadConfig>;
}

/**
 * Create a LiveViewSocket for a connection.
 * The socket holds assigns and provides assign(), subscribe(), broadcast().
 */
function createSocket(subscriber: PubSub.Subscriber): LiveViewSocket {
  const socket: LiveViewSocket = {
    assigns: {},
    assign(newAssigns: Record<string, unknown>) {
      Object.assign(socket.assigns, newAssigns);
    },
    subscribe(topic: string) {
      PubSub.subscribe(topic, subscriber);
    },
    broadcast(topic: string, message: unknown) {
      PubSub.broadcast(topic, message, subscriber);
    },
    pushRedirect(redirectPath: string) {
      socket.assigns.__redirect__ = redirectPath;
    },
    stream(name: string, initialItems: any[], opts: Stream.StreamInitOpts) {
      Stream.stream(socket.assigns, name, initialItems, opts);
    },
    streamInsert(name: string, item: any, opts?: Stream.StreamInsertOpts) {
      Stream.streamInsert(socket.assigns, name, item, opts);
    },
    streamDelete(name: string, item: any) {
      Stream.streamDelete(socket.assigns, name, item);
    },
    allowUpload(name: string, opts: Upload.AllowUploadOpts = {}) {
      const uploads = getUploads(socket.assigns);
      uploads[name] = Upload.createUploadConfig(name, opts);
    },
    async consumeUploadedEntries(
      name: string,
      callback: (entry: Upload.UploadEntry) => Promise<any> | any,
    ): Promise<any[]> {
      const uploads = getUploads(socket.assigns);
      const config = uploads[name];
      if (!config) return [];
      const results: any[] = [];
      const completed = config.entries.filter((e) => e.done);
      for (const entry of completed) {
        const result = await callback(entry);
        results.push(result);
        try { await unlink(entry.tmpPath); } catch {}
      }
      config.entries = config.entries.filter((e) => !e.done);
      return results;
    },
    getUploads(): Record<string, Upload.UploadConfig> {
      return getUploads(socket.assigns);
    },
    trackPresence(topic: string, key: string, meta: Presence.PresenceMeta) {
      Presence.track(topic, key, meta, subscriber);
    },
    listPresences(topic: string): Record<string, Presence.PresenceMeta> {
      return Presence.list(topic);
    },
  };
  return socket;
}

/**
 * Re-render a view and send diff (or full render) to the client.
 * Shared by handleEvent responses and PubSub handleInfo callbacks.
 */
function sendUpdate(
  ws: WebSocket<LiveConnection>,
  data: LiveConnection,
): void {
  if (!data.view || !data.socket) return;

  const result = data.view.render(data.socket.assigns);
  const streamsPayload = Stream.extractStreamOps(data.socket.assigns);

  if (isRendered(result)) {
    if (data.prevDynamics) {
      const diff = diffDynamics(data.prevDynamics, result.dynamics);
      data.prevDynamics = result.dynamics;
      if (diff || streamsPayload) {
        const msg: Record<string, any> = { type: "diff" };
        if (diff) msg.dynamics = diff;
        if (streamsPayload) msg.streams = streamsPayload;
        ws.send(JSON.stringify(msg));
      }
    } else {
      data.prevDynamics = result.dynamics;
      const msg: Record<string, any> = {
        type: "mount",
        statics: result.statics,
        dynamics: result.dynamics,
      };
      if (streamsPayload) msg.streams = streamsPayload;
      ws.send(JSON.stringify(msg));
    }
  } else {
    data.prevDynamics = undefined;
    const msg: Record<string, any> = { type: "render", html: result };
    if (streamsPayload) msg.streams = streamsPayload;
    ws.send(JSON.stringify(msg));
  }

  // Reset temporary assigns to their defaults after render
  resetTemporaryAssigns(data.view, data.socket);
}

/**
 * Reset temporary assigns to their declared defaults.
 * Called after each render so large data doesn't accumulate.
 */
function resetTemporaryAssigns(view: LiveView, socket: LiveViewSocket): void {
  const temps = view.temporary_assigns;
  for (const key in temps) {
    socket.assigns[key] = temps[key];
  }
}

/**
 * Handle WebSocket open: instantiate LiveView, mount, render, send.
 */
export async function handleOpen(
  ws: WebSocket<LiveConnection>,
  liveRoutes: Map<string, LiveViewClass>,
): Promise<void> {
  const data = ws.getUserData();
  const ViewClass = liveRoutes.get(data.path);

  if (!ViewClass) {
    ws.send(JSON.stringify({ type: "error", message: `No LiveView for path: ${data.path}` }));
    ws.close();
    return;
  }

  incrementConnections();

  const view = new ViewClass();

  // Create the PubSub subscriber callback for this connection.
  // When a broadcast arrives, it calls handleInfo → re-render → send diff.
  const subscriber: PubSub.Subscriber = async (message: unknown) => {
    if (view.handleInfo) {
      const infoResult = view.handleInfo(message, socket);
      if (infoResult instanceof Promise) await infoResult;
      sendUpdate(ws, data);
    }
  };

  const socket = createSocket(subscriber);
  data.view = view;
  data.socket = socket;
  data.subscriber = subscriber;

  await view.mount(socket);

  sendUpdate(ws, data);
}

/**
 * Handle WebSocket message: parse event, call handleEvent, re-render, send diff.
 * Also handles binary upload chunks and upload-specific events.
 */
export async function handleMessage(
  ws: WebSocket<LiveConnection>,
  message: ArrayBuffer,
  isBinary: boolean,
): Promise<void> {
  const data = ws.getUserData();
  if (!data.view || !data.socket) return;

  // IMPORTANT: uWebSockets.js ArrayBuffer is stack-allocated.
  // Buffer.from(ArrayBuffer) creates a VIEW (shared memory), not a copy.
  // We must copy the data before any async operation, or it gets detached.
  const copied = Buffer.from(new Uint8Array(message));

  // Binary frames are upload chunks
  if (isBinary) {
    await handleUploadChunk(ws, data, copied);
    return;
  }

  let parsed: { type: string; event?: string; params?: Record<string, unknown> };
  try {
    parsed = JSON.parse(copied.toString("utf-8"));
  } catch {
    return; // Ignore malformed messages
  }

  if (parsed.type === "event" && parsed.event) {
    const eventName = parsed.event;

    // Upload-specific events
    if (eventName === "__upload_validate__") {
      handleUploadValidate(ws, data, parsed.params ?? {});
      return;
    }
    if (eventName === "__upload_complete__") {
      handleUploadComplete(ws, data, parsed.params ?? {});
      return;
    }

    const colonIdx = eventName.indexOf(":");

    if (colonIdx > 0) {
      // Component event: "componentId:event" → route to component's handleEvent
      const componentId = eventName.slice(0, colonIdx);
      const componentEvent = eventName.slice(colonIdx + 1);
      const components = (data.socket.assigns.__components__ ?? {}) as Record<string, ComponentEntry>;
      const entry = components[componentId];
      if (entry) {
        const [CompClass, compAssigns] = entry;
        const instance = new CompClass();
        instance.handleEvent(componentEvent, parsed.params ?? {}, compAssigns);
      }
    } else {
      // Parent LiveView event
      await data.view.handleEvent(eventName, parsed.params ?? {}, data.socket);
    }

    // Check for server-initiated redirect
    const redirect = data.socket.assigns.__redirect__ as string | undefined;
    if (redirect) {
      delete data.socket.assigns.__redirect__;
      ws.send(JSON.stringify({ type: "redirect", path: redirect }));
    } else {
      sendUpdate(ws, data);
    }
  }
}

/**
 * Handle WebSocket close: cleanup, unsubscribe from PubSub, remove temp upload files.
 */
export function handleClose(ws: WebSocket<LiveConnection>): void {
  decrementConnections();
  const data = ws.getUserData();

  // Unsubscribe from PubSub FIRST so this connection doesn't receive
  // its own leave broadcasts (ws is already closed at this point).
  if (data.subscriber) {
    PubSub.unsubscribeAll(data.subscriber);
  }

  // Now broadcast presence leave diffs to remaining subscribers
  if (data.subscriber) {
    Presence.untrackAll(data.subscriber);
  }

  // Clean up upload temp files
  if (data.socket) {
    const uploads = data.socket.assigns.__uploads__ as Record<string, Upload.UploadConfig> | undefined;
    if (uploads) {
      for (const name in uploads) {
        for (const entry of uploads[name]!.entries) {
          if (entry.tmpPath) {
            unlink(entry.tmpPath).catch(() => {});
          }
        }
      }
    }
  }

  data.view = undefined;
  data.socket = undefined;
  data.prevDynamics = undefined;
  data.subscriber = undefined;
}

/** Handle upload validation: client sends file metadata, server validates and responds. */
function handleUploadValidate(
  ws: WebSocket<LiveConnection>,
  data: LiveConnection,
  params: Record<string, unknown>,
): void {
  if (!data.socket) return;
  const uploadName = params.name as string;
  const uploads = getUploads(data.socket.assigns);
  const config = uploads[uploadName];
  if (!config) {
    ws.send(JSON.stringify({ type: "error", message: `No upload config for "${uploadName}"` }));
    return;
  }

  const clientEntries = (params.entries ?? []) as { ref: string; name: string; type: string; size: number }[];
  Upload.validateEntries(config, clientEntries);

  // Send upload config back to client
  ws.send(JSON.stringify({
    type: "upload",
    config: Upload.serializeConfig(config),
  }));

  // Also send a diff so the UI updates with entry state
  sendUpdate(ws, data);
}

/** Handle upload completion: client signals a file is fully uploaded. */
function handleUploadComplete(
  ws: WebSocket<LiveConnection>,
  data: LiveConnection,
  params: Record<string, unknown>,
): void {
  if (!data.socket) return;
  const ref = params.ref as string;
  const uploads = getUploads(data.socket.assigns);
  const found = Upload.findEntry(uploads, ref);
  if (found) {
    found.entry.done = true;
    found.entry.progress = 100;
  }

  sendUpdate(ws, data);
}

/** Handle a binary upload chunk: append to temp file, update progress. */
async function handleUploadChunk(
  ws: WebSocket<LiveConnection>,
  data: LiveConnection,
  buf: Buffer,
): Promise<void> {
  if (!data.socket) return;
  const parsed = Upload.parseUploadFrame(buf);
  if (!parsed) return;

  const uploads = getUploads(data.socket.assigns);
  const found = Upload.findEntry(uploads, parsed.ref);
  if (!found) return;

  const { entry } = found;

  const prevProgress = entry.progress;

  try {
    await appendFile(entry.tmpPath, parsed.chunk);
    entry.bytesReceived += parsed.chunk.length;
    entry.progress = Math.min(
      99,
      Math.round((entry.bytesReceived / entry.clientSize) * 100),
    );
  } catch (err) {
    console.error("Upload chunk write error:", err);
    entry.errors.push("Write error");
    entry.valid = false;
  }

  // Only send UI updates every ~10% to avoid overwhelming the WebSocket
  if (entry.progress >= prevProgress + 10 || !entry.valid) {
    sendUpdate(ws, data);
  }
}

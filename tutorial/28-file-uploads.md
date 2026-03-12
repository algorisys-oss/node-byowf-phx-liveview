# Step 28: File Uploads

[← Previous: Step 27 - Temporary Assigns](27-temporary-assigns.md) | [Next: Step 29 →](29-flash-messages-sessions.md)

---

## What We're Building

File uploads over WebSocket, with chunked binary transfer and real-time
progress tracking. No HTTP multipart -- files are sliced into chunks on the
client, sent as binary WebSocket frames, and reassembled on the server.

This mirrors Phoenix LiveView's upload system: `allowUpload()` to configure,
`bv-upload` binding on file inputs, and `consumeUploadedEntries()` to process
completed files.

## Concepts You'll Learn

- Server-side upload configuration and validation
- Binary WebSocket frame format for chunked uploads
- Client-side file slicing with `FileReader` API
- Progress tracking across chunks
- Consuming completed uploads in event handlers

## The Code

### 1. Complete Upload Module (`src/blaze/upload.ts`)

This is the entire upload module. It handles config creation, entry
validation, binary frame parsing, entry lookup, and wire serialization.

```typescript
/**
 * Blaze LiveView Uploads -- File uploads over WebSocket.
 *
 * Files are uploaded as binary WebSocket frames in chunks, with
 * server-side validation and real-time progress tracking.
 *
 * Usage in a LiveView:
 *   mount(socket) {
 *     socket.allowUpload("photos", { accept: ["image/*"], maxFileSize: 5_000_000 });
 *   }
 *   handleEvent("save", _params, socket) {
 *     const files = await socket.consumeUploadedEntries("photos", async (entry) => {
 *       // Move from temp path to final destination
 *       return { name: entry.clientName, size: entry.clientSize };
 *     });
 *   }
 */

import { randomUUID } from "node:crypto";

export interface AllowUploadOpts {
  accept?: string[];
  maxEntries?: number;
  maxFileSize?: number;
  chunkSize?: number;
  autoUpload?: boolean;
}

/** Server-side upload configuration for a named upload input. */
export interface UploadConfig {
  name: string;
  accept: string[];
  maxEntries: number;
  maxFileSize: number;
  chunkSize: number;
  autoUpload: boolean;
  entries: UploadEntry[];
  errors: string[];
}

/** Per-file upload entry tracking. */
export interface UploadEntry {
  ref: string;
  clientName: string;
  clientType: string;
  clientSize: number;
  tmpPath: string;
  bytesReceived: number;
  progress: number;
  done: boolean;
  valid: boolean;
  errors: string[];
}

/** Create a new upload configuration with defaults. */
export function createUploadConfig(
  name: string,
  opts: AllowUploadOpts,
): UploadConfig {
  return {
    name,
    accept: opts.accept ?? [],
    maxEntries: opts.maxEntries ?? 3,
    maxFileSize: opts.maxFileSize ?? 8_000_000,
    chunkSize: opts.chunkSize ?? 64_000,
    autoUpload: opts.autoUpload ?? false,
    entries: [],
    errors: [],
  };
}

/** Validate incoming file entries against upload config. */
export function validateEntries(
  config: UploadConfig,
  clientEntries: { ref: string; name: string; type: string; size: number }[],
): UploadEntry[] {
  config.entries = [];
  config.errors = [];

  if (clientEntries.length > config.maxEntries) {
    config.errors.push(`Too many files (max ${config.maxEntries})`);
  }

  for (const ce of clientEntries) {
    const entry: UploadEntry = {
      ref: ce.ref,
      clientName: ce.name,
      clientType: ce.type,
      clientSize: ce.size,
      tmpPath: `/tmp/blaze-upload-${randomUUID()}`,
      bytesReceived: 0,
      progress: 0,
      done: false,
      valid: true,
      errors: [],
    };

    // Validate size
    if (ce.size > config.maxFileSize) {
      entry.valid = false;
      entry.errors.push(`File too large (max ${formatBytes(config.maxFileSize)})`);
    }

    // Validate type
    if (config.accept.length > 0 && !matchesAccept(ce.type, config.accept)) {
      entry.valid = false;
      entry.errors.push(`Invalid file type (accepts: ${config.accept.join(", ")})`);
    }

    config.entries.push(entry);
  }

  return config.entries;
}

/** Check if a MIME type matches any of the accept patterns. */
function matchesAccept(mimeType: string, accept: string[]): boolean {
  for (const pattern of accept) {
    if (pattern === mimeType) return true;
    // Wildcard: "image/*" matches "image/jpeg"
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // "image/"
      if (mimeType.startsWith(prefix)) return true;
    }
    // Extension: ".jpg" — accept for now, client validates extension
    if (pattern.startsWith(".")) return true;
  }
  return false;
}

/** Parse a binary upload frame: [2-byte ref_len][ref_string][chunk_data] */
export function parseUploadFrame(data: Buffer): { ref: string; chunk: Buffer } | null {
  if (data.length < 2) return null;
  const refLen = data.readUInt16BE(0);
  if (data.length < 2 + refLen) return null;
  const ref = data.subarray(2, 2 + refLen).toString("utf8");
  const chunk = data.subarray(2 + refLen);
  return { ref, chunk };
}

/** Find an upload entry by ref across all upload configs. */
export function findEntry(
  uploads: Record<string, UploadConfig>,
  ref: string,
): { config: UploadConfig; entry: UploadEntry } | null {
  for (const name in uploads) {
    const config = uploads[name]!;
    const entry = config.entries.find((e) => e.ref === ref);
    if (entry) return { config, entry };
  }
  return null;
}

/** Build a serializable upload config for the wire. */
export function serializeConfig(config: UploadConfig): Record<string, any> {
  return {
    name: config.name,
    accept: config.accept,
    maxEntries: config.maxEntries,
    maxFileSize: config.maxFileSize,
    chunkSize: config.chunkSize,
    autoUpload: config.autoUpload,
    entries: config.entries.map((e) => ({
      ref: e.ref,
      clientName: e.clientName,
      clientType: e.clientType,
      clientSize: e.clientSize,
      progress: e.progress,
      done: e.done,
      valid: e.valid,
      errors: e.errors,
    })),
    errors: config.errors,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

### 2. LiveViewSocket Upload Methods (`src/blaze/live_view.ts`)

Add upload methods to the socket interface:

```typescript
import type { AllowUploadOpts, UploadConfig, UploadEntry } from "./upload.js";

export interface LiveViewSocket {
  // ...existing methods...

  /** Configure a file upload input */
  allowUpload(name: string, opts?: AllowUploadOpts): void;

  /** Process completed uploads, callback receives each entry */
  consumeUploadedEntries(
    name: string,
    callback: (entry: UploadEntry) => Promise<any> | any,
  ): Promise<any[]>;

  /** Read upload state for templates */
  getUploads(): Record<string, UploadConfig>;
}
```

### 3. Server Handler Functions (`src/blaze/live_handler.ts`)

The handler needs four things: a helper to access uploads from assigns,
upload method wiring in `createSocket()`, three upload-specific message
handlers, and binary frame detection in `handleMessage()`.

**Upload assigns helper:**

```typescript
import * as Upload from "./upload.js";

/** Get or initialize the uploads map on assigns. */
function getUploads(assigns: Record<string, unknown>): Record<string, Upload.UploadConfig> {
  if (!assigns.__uploads__) assigns.__uploads__ = {};
  return assigns.__uploads__ as Record<string, Upload.UploadConfig>;
}
```

**Upload methods wired into `createSocket()`:**

```typescript
function createSocket(subscriber: PubSub.Subscriber): LiveViewSocket {
  const socket: LiveViewSocket = {
    // ...existing assign/subscribe/broadcast/pushRedirect/stream methods...

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
  };
  return socket;
}
```

`consumeUploadedEntries()` iterates over completed entries, calls the
user callback for each, deletes the temp file, then removes completed
entries from the config. The `unlink` import is from `node:fs/promises`.

**Upload validate handler** -- called when the client sends file metadata
for validation:

```typescript
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
```

**Upload complete handler** -- called when the client signals a file is
fully uploaded:

```typescript
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
```

**Binary chunk handler** -- called when a binary WebSocket frame arrives.
Parses the frame, appends the chunk to the temp file, updates progress,
and sends a UI update every ~10%:

```typescript
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
```

**Binary vs JSON detection in `handleMessage()`** -- uWebSockets.js tells
us whether a frame is binary. Binary frames are upload chunks; text frames
are JSON events:

```typescript
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

    // Parent LiveView event
    await data.view.handleEvent(eventName, parsed.params ?? {}, data.socket);

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
```

**Cleanup on close** -- when a WebSocket disconnects, delete any temp files
that were still in progress:

```typescript
export function handleClose(ws: WebSocket<LiveConnection>): void {
  const data = ws.getUserData();

  // ...PubSub unsubscribe, presence cleanup...

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
```

### 4. `src/blaze/server.ts` -- Binary Frame Support

The WebSocket handler must allow large binary frames (default uWS limit
is 16KB, too small for file chunks) and pass `isBinary` to the handler:

```typescript
app.ws<LiveConnection>("/live/websocket", {
  // Allow large binary frames for file upload chunks (default is 16KB)
  maxPayloadLength: 512 * 1024,

  // ...upgrade handler...

  open: (ws) => {
    handleOpen(ws, liveRoutes).catch((err) => {
      console.error("LiveView open error:", err);
    });
  },

  message: (ws, message, isBinary) => {
    handleMessage(ws, message, isBinary).catch((err) => {
      console.error("LiveView message error:", err);
    });
  },

  close: (ws) => {
    handleClose(ws);
  },
});
```

### 5. Client Upload Code (`public/blaze.js`)

The complete client-side upload implementation. Four functions handle the
full upload lifecycle: validate, handle config response, start upload, and
send chunks.

**Upload state variables:**

```javascript
// ── Upload state ──
var uploadConfigs = {};  // Server-validated configs by name
var pendingFiles = {};   // Files waiting for upload by name
var uploading = false;   // Prevent concurrent uploads
```

**File selection via `bv-upload` binding** -- detected in the `change`
event handler. When a file input with `bv-upload` changes, we store the
files and send metadata to the server for validation:

```javascript
// In the change event handler:
container.addEventListener("change", function (e) {
  // bv-upload: file input for uploads
  var uploadTarget = e.target.closest("[bv-upload]");
  if (uploadTarget && uploadTarget.type === "file") {
    var uploadName = uploadTarget.getAttribute("bv-upload");
    validateUpload(uploadName, uploadTarget);
    return;
  }

  // ...existing bv-change handling...
});
```

**Validation request** -- sends file metadata to the server:

```javascript
function validateUpload(uploadName, fileInput) {
  var files = Array.from(fileInput.files || []);
  if (files.length === 0) return;

  pendingFiles[uploadName] = files;

  // Send file metadata to server for validation
  var entries = files.map(function (file, i) {
    return {
      ref: uploadName + "-" + i + "-" + Date.now(),
      name: file.name,
      type: file.type,
      size: file.size,
    };
  });

  sendEvent("__upload_validate__", { name: uploadName, entries: entries });
}
```

**Upload config response handler** -- stores the server-validated config
and starts uploading if `autoUpload` is enabled:

```javascript
function handleUploadConfig(config) {
  uploadConfigs[config.name] = config;

  if (config.autoUpload) {
    startUpload(config.name);
  }
}
```

In the message handler, the `upload` message type triggers this:

```javascript
} else if (msg.type === "upload") {
  handleUploadConfig(msg.config);
}
```

**Start upload** -- iterates over valid entries and uploads each file
sequentially:

```javascript
function startUpload(uploadName) {
  var config = uploadConfigs[uploadName];
  var files = pendingFiles[uploadName];
  if (!config || !files || uploading) return;

  // Only upload valid entries
  var validEntries = config.entries.filter(function (e) { return e.valid; });
  if (validEntries.length === 0) return;

  uploading = true;

  // Upload files sequentially
  var idx = 0;
  function uploadNext() {
    if (idx >= validEntries.length) {
      uploading = false;
      delete pendingFiles[uploadName];
      return;
    }

    var entry = validEntries[idx];
    var file = files[idx];
    idx++;

    if (!file) {
      uploadNext();
      return;
    }

    sendFileChunks(entry.ref, file, config.chunkSize, function () {
      // Signal upload complete for this file
      sendEvent("__upload_complete__", { ref: entry.ref });
      uploadNext();
    });
  }

  uploadNext();
}
```

**Chunked binary upload** -- slices the file into chunks and sends each
as a binary WebSocket frame with the ref prepended:

```javascript
function sendFileChunks(ref, file, chunkSize, onDone) {
  var offset = 0;
  var refBytes = new TextEncoder().encode(ref);

  function sendNextChunk() {
    if (offset >= file.size) {
      if (onDone) onDone();
      return;
    }

    var end = Math.min(offset + chunkSize, file.size);
    var slice = file.slice(offset, end);
    offset = end;

    var reader = new FileReader();
    reader.onload = function () {
      var chunkData = new Uint8Array(reader.result);
      // Build binary frame: [2-byte ref_len][ref][chunk]
      var frame = new Uint8Array(2 + refBytes.length + chunkData.length);
      frame[0] = (refBytes.length >> 8) & 0xff;
      frame[1] = refBytes.length & 0xff;
      frame.set(refBytes, 2);
      frame.set(chunkData, 2 + refBytes.length);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(frame.buffer);
      }

      // Small delay between chunks to avoid overwhelming the server
      setTimeout(sendNextChunk, 10);
    };
    reader.readAsArrayBuffer(slice);
  }

  sendNextChunk();
}
```

**Trigger upload from form submit** -- for non-autoUpload configs, the
form submit handler triggers pending uploads:

```javascript
function triggerUpload(uploadName) {
  startUpload(uploadName);
}

// In the submit handler:
container.addEventListener("submit", function (e) {
  var form = e.target.closest("[bv-submit]");
  if (form) {
    e.preventDefault();
    var event = form.getAttribute("bv-submit");
    var formData = new FormData(form);
    var params = {};
    formData.forEach(function (value, key) {
      // Skip file inputs — handled by bv-upload
      if (value instanceof File) return;
      params[key] = value;
    });

    // Trigger pending uploads before sending the form event
    var uploadInputs = form.querySelectorAll("[bv-upload]");
    for (var i = 0; i < uploadInputs.length; i++) {
      var uploadName = uploadInputs[i].getAttribute("bv-upload");
      if (uploadName && pendingFiles[uploadName]) {
        triggerUpload(uploadName);
      }
    }

    sendEvent(event, params);
  }
});
```

**Morphdom must skip file inputs** -- to prevent the browser from clearing
the file selection when the DOM patches:

```javascript
morphdom(container, wrapper, {
  onBeforeElUpdated: function (fromEl, toEl) {
    if (fromEl.type === "file") return false;
    // ...rest of the callback...
  },
});
```

### 6. Demo LiveView (`src/my_app/upload_demo_live.ts`)

A complete demo showing file selection, validation, progress tracking,
and consuming uploaded entries:

```typescript
/**
 * UploadDemoLive -- Demonstrates file uploads over WebSocket.
 *
 * Features:
 * - File selection with bv-upload binding
 * - Server-side validation (type, size, max entries)
 * - Chunked binary upload with progress tracking
 * - consumeUploadedEntries to process completed files
 */

import { copyFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "..", "..", "public", "uploads");

export class UploadDemoLive extends LiveView {
  mount(socket: LiveViewSocket): void {
    socket.allowUpload("photos", {
      accept: ["image/*"],
      maxEntries: 3,
      maxFileSize: 5_000_000,
      chunkSize: 64_000,
      autoUpload: true,
    });

    socket.assign({
      uploadedFiles: [] as { name: string; size: string; url: string }[],
    });
  }

  async handleEvent(
    event: string,
    _params: Record<string, unknown>,
    socket: LiveViewSocket,
  ): Promise<void> {
    if (event === "save") {
      await mkdir(UPLOADS_DIR, { recursive: true });
      const files = await socket.consumeUploadedEntries(
        "photos",
        async (entry) => {
          // Generate a unique filename to avoid collisions
          const ext = extname(entry.clientName);
          const baseName = entry.clientName.replace(ext, "");
          const savedName = `${baseName}-${Date.now()}${ext}`;
          const destPath = join(UPLOADS_DIR, savedName);

          // Copy from temp to public/uploads/
          await copyFile(entry.tmpPath, destPath);

          return {
            name: entry.clientName,
            size: formatSize(entry.clientSize),
            url: `/public/uploads/${savedName}`,
          };
        },
      );
      const existing = (socket.assigns.uploadedFiles as { name: string; size: string; url: string }[]) || [];
      socket.assign({ uploadedFiles: [...existing, ...files] });
    }
  }

  render(assigns: Record<string, unknown>): Rendered {
    const uploads = assigns.__uploads__ as Record<string, any> | undefined;
    const config = uploads?.photos;
    const entries = config?.entries || [];
    const errors = config?.errors || [];
    const uploadedFiles = (assigns.uploadedFiles as { name: string; size: string; url: string }[]) || [];

    let entriesHtml = "";
    for (const entry of entries) {
      const statusColor = entry.done ? "#2a2" : entry.valid ? "#36c" : "#c33";
      const statusText = entry.done
        ? "Done"
        : entry.valid
          ? `${entry.progress}%`
          : entry.errors.join(", ");
      entriesHtml += `<div style="padding:0.4rem 0.6rem; margin:0.2rem 0; background:#f8f8f8;
                          border-radius:4px; border-left:3px solid ${statusColor};
                          display:flex; justify-content:space-between;">
        <span>${entry.clientName} (${formatSize(entry.clientSize)})</span>
        <span style="color:${statusColor}; font-weight:bold;">${statusText}</span>
      </div>`;
    }

    let errorsHtml = "";
    for (const err of errors) {
      errorsHtml += `<p style="color:#c33;">${err}</p>`;
    }

    let uploadedHtml = "";
    for (const f of uploadedFiles) {
      uploadedHtml += `<li style="margin:0.8rem 0; list-style:none;">
        <div style="display:flex; align-items:center; gap:1rem;">
          <img src="${f.url}" style="width:80px; height:80px; object-fit:cover; border-radius:4px; border:1px solid #ddd;" />
          <div>
            <strong>${f.name}</strong> (${f.size})<br>
            <a href="${f.url}" target="_blank" style="display:inline-block; margin-top:0.3rem;
               padding:0.2rem 0.6rem; background:#36c; color:white; text-decoration:none;
               border-radius:3px; font-size:0.85rem;">View / Download</a>
          </div>
        </div>
      </li>`;
    }

    return bv`
      <h1>File Uploads</h1>

      <form bv-submit="save">
        <div style="border:2px dashed #ccc; border-radius:8px; padding:2rem; text-align:center; margin:1rem 0;">
          <p>Select images to upload (max 3 files, 5MB each)</p>
          <input type="file" bv-upload="photos" multiple accept="image/*"
                 style="font-size:1rem;" />
        </div>

        ${errorsHtml}
        ${entriesHtml}

        <button type="submit" style="padding:0.5rem 1.5rem; font-size:1rem; cursor:pointer;
                background:#2a2; color:white; border:none; border-radius:4px; margin-top:0.5rem;">
          Save Uploads
        </button>
      </form>

      ${uploadedFiles.length > 0
        ? `<h2>Saved Files</h2><ul>${uploadedHtml}</ul>`
        : ""}

      <p style="color:#888; font-size:0.85rem; margin-top:1rem;">
        Files are uploaded as binary WebSocket chunks. Auto-upload is enabled --
        upload starts as soon as files are selected. Click "Save" to consume entries.
      </p>
    `;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

## How It Works

### Upload Flow

```
User selects 2 images in file input
  ↓
bv-upload change handler → validateUpload("photos", input)
  ↓
Client stores files in pendingFiles["photos"]
Client sends: { type: "event", event: "__upload_validate__",
                params: { name: "photos",
                          entries: [{ ref: "photos-0-17...", name: "cat.jpg", type: "image/jpeg", size: 245000 },
                                    { ref: "photos-1-17...", name: "dog.png", type: "image/png", size: 180000 }] } }
  ↓
Server: handleUploadValidate() → Upload.validateEntries(config, clientEntries)
  - Creates UploadEntry per file with tmpPath = /tmp/blaze-upload-<uuid>
  - Validates size (< 5MB) and type (image/*)
  - Marks invalid entries with valid: false and error messages
  ↓
Server sends: { type: "upload", config: { name: "photos", autoUpload: true, chunkSize: 64000,
                entries: [{ ref: "photos-0-17...", progress: 0, valid: true, errors: [] }, ...] } }
  ↓
Client: handleUploadConfig() stores config
  autoUpload: true → startUpload("photos")
  ↓
Client: uploadNext() → sendFileChunks(ref, file, 64000, onDone)
  ↓
sendFileChunks reads file in 64KB slices using FileReader:
  ↓
  Binary frame: [0x00 0x0E][photos-0-17...][ ...64KB of image data... ]
  ↓
Server: handleMessage() detects isBinary → handleUploadChunk()
  → Upload.parseUploadFrame(buf) → { ref: "photos-0-17...", chunk: <Buffer ...> }
  → appendFile(entry.tmpPath, chunk)
  → entry.bytesReceived += chunk.length
  → entry.progress = Math.min(99, Math.round(bytesReceived / clientSize * 100))
  → sendUpdate() every ~10% progress change
  ↓
Server sends diff with updated progress (0% → 15% → 30% → ... → 99%)
  ↓
Client: last chunk sent → sendEvent("__upload_complete__", { ref: "photos-0-17..." })
  ↓
Server: handleUploadComplete() → entry.done = true, entry.progress = 100
  → sendUpdate() → UI shows "Done" for this entry
  ↓
Client: uploadNext() → starts next file (sequential upload)
  ↓
All files uploaded → uploading = false
  ↓
User clicks "Save Uploads"
  ↓
Client sends: { type: "event", event: "save", params: {} }
  ↓
Server: handleEvent("save") → socket.consumeUploadedEntries("photos", callback)
  → callback receives each completed entry with entry.tmpPath
  → callback copies file from /tmp to public/uploads/ with unique name
  → temp file deleted via unlink(entry.tmpPath)
  → completed entries removed from config.entries
  → returns array of { name, size, url }
  ↓
socket.assign({ uploadedFiles: [...existing, ...files] })
  ↓
sendUpdate() → UI shows saved files with thumbnails and download links
```

## Binary Frame Format

```
┌──────────┬──────────────┬──────────────────┐
│ 2 bytes  │ N bytes      │ remaining bytes  │
│ ref_len  │ ref_string   │ chunk_data       │
│ (BE u16) │ (UTF-8)      │ (raw binary)     │
└──────────┴──────────────┴──────────────────┘
```

- `ref_len`: Big-endian unsigned 16-bit integer (max ref length: 65535)
- `ref_string`: UTF-8 encoded entry reference (e.g., "photos-0-1709123456789")
- `chunk_data`: Raw file bytes (up to `chunkSize` bytes)

**Example** for a ref "photos-0-1709123456789" (21 bytes):

```
[0x00 0x15][photos-0-1709123456789][<64000 bytes of image data>]
```

The server parses this with `parseUploadFrame()`:
1. Read 2 bytes as big-endian uint16 to get ref length (0x0015 = 21)
2. Read next 21 bytes as UTF-8 string to get the ref
3. Everything after is the chunk data

## Try It Out

```bash
npx tsx src/app.ts
# Visit http://localhost:4001/uploads
```

- Select 1-3 image files -- upload starts automatically (autoUpload: true)
- Watch progress update in real-time (updates every ~10%)
- Click "Save Uploads" to consume entries -- files appear in the saved list with thumbnails
- Try selecting > 3 files -- validation error: "Too many files (max 3)"
- Try a non-image file -- type validation error
- Open DevTools Network tab -- you'll see binary WebSocket frames for chunks

## File Checklist

| File | Action | Purpose |
|------|--------|---------|
| `src/blaze/upload.ts` | **New** | Upload config, validation, binary frame parsing, serialization |
| `src/my_app/upload_demo_live.ts` | **New** | Demo with image upload, progress, save to public/uploads/ |
| `src/blaze/live_view.ts` | Modified | Added allowUpload, consumeUploadedEntries, getUploads to socket |
| `src/blaze/live_handler.ts` | Modified | Upload validate/chunk/complete handlers, binary frame detection, temp file cleanup |
| `src/blaze/server.ts` | Modified | maxPayloadLength for large binary frames, pass isBinary to handleMessage |
| `public/blaze.js` | Modified | bv-upload binding, validateUpload, sendFileChunks, upload config handling, file input skip in morphdom |
| `src/app.ts` | Modified | Added /uploads route |

---

[← Previous: Step 27 - Temporary Assigns](27-temporary-assigns.md) | [Next: Step 29 →](29-flash-messages-sessions.md)

## What's Next

In **Step 29**, we'll add **Flash Messages & Sessions** -- signed cookie
sessions and flash messages that display once and disappear, similar to
Phoenix's `put_flash/3`.

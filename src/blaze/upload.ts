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

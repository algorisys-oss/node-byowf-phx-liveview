/**
 * Blaze LiveView Streams -- Efficient list rendering via DOM-level operations.
 *
 * Instead of re-rendering entire lists, streams send targeted insert/delete
 * operations that the client applies directly to the DOM.
 *
 * Usage in a LiveView:
 *   mount(socket) {
 *     socket.stream("events", [], { render: (e) => `<div id="events-${e.id}">${e.text}</div>` });
 *   }
 *   handleEvent("add", params, socket) {
 *     socket.streamInsert("events", { id: "1", text: "Hello" }, { at: 0 });
 *   }
 */

/** A single stream's server-side state */
export interface StreamState {
  name: string;
  renderFn: (item: any) => string;
  idFn: (item: any) => string;
  domPrefix: string;
  limit: number | null;
  /** Queued operations since last render */
  ops: StreamOp[];
  /** Set of known DOM IDs (for upsert detection) */
  items: Set<string>;
  /** Insertion order (for limit pruning) */
  order: string[];
}

export type StreamOp =
  | { type: "insert"; item: any; domId: string; at: number }
  | { type: "delete"; domId: string }
  | { type: "reset" };

export interface StreamInsertOpts {
  at?: number; // 0 = prepend, -1 = append (default)
}

export interface StreamInitOpts {
  render: (item: any) => string;
  id?: (item: any) => string;
  domPrefix?: string;
  limit?: number;
}

/** All streams state stored in assigns.__streams__ */
type StreamsMap = Record<string, StreamState>;

function getStreams(assigns: Record<string, unknown>): StreamsMap {
  if (!assigns.__streams__) assigns.__streams__ = {};
  return assigns.__streams__ as StreamsMap;
}

/**
 * Initialize a stream with a name, initial items, and options.
 * Must provide a `render` function that returns HTML for each item.
 * Each item's HTML MUST have a root element with `id="${domPrefix}-${item.id}"`.
 */
export function stream(
  assigns: Record<string, unknown>,
  name: string,
  initialItems: any[],
  opts: StreamInitOpts,
): void {
  const streams = getStreams(assigns);
  const idFn = opts.id ?? ((item: any) => String(item.id));
  const domPrefix = opts.domPrefix ?? name;
  const limit = opts.limit ?? null;

  const state: StreamState = {
    name,
    renderFn: opts.render,
    idFn,
    domPrefix,
    limit,
    ops: [],
    items: new Set(),
    order: [],
  };

  // Insert initial items
  for (const item of initialItems) {
    const domId = domPrefix + "-" + idFn(item);
    state.ops.push({ type: "insert", item, domId, at: -1 });
    state.items.add(domId);
    state.order.push(domId);
  }

  // Apply limit if needed
  if (limit !== null) {
    applyLimit(state, -1);
  }

  streams[name] = state;
}

/**
 * Insert (or update) an item in a stream.
 * If an item with the same DOM ID already exists, it's updated in-place (upsert).
 */
export function streamInsert(
  assigns: Record<string, unknown>,
  name: string,
  item: any,
  opts: StreamInsertOpts = {},
): void {
  const streams = getStreams(assigns);
  const state = streams[name];
  if (!state) throw new Error(`Stream "${name}" not initialized. Call stream() first.`);

  const at = opts.at ?? -1;
  const domId = state.domPrefix + "-" + state.idFn(item);
  const isUpdate = state.items.has(domId);

  state.ops.push({ type: "insert", item, domId, at });
  state.items.add(domId);

  if (!isUpdate) {
    // New item: add to order
    if (at === 0) {
      state.order.unshift(domId);
    } else {
      state.order.push(domId);
    }
    // Apply limit (may auto-prune oldest)
    if (state.limit !== null) {
      applyLimit(state, at);
    }
  }
}

/**
 * Delete an item from a stream.
 */
export function streamDelete(
  assigns: Record<string, unknown>,
  name: string,
  item: any,
): void {
  const streams = getStreams(assigns);
  const state = streams[name];
  if (!state) throw new Error(`Stream "${name}" not initialized. Call stream() first.`);

  const domId = state.domPrefix + "-" + state.idFn(item);
  state.ops.push({ type: "delete", domId });
  state.items.delete(domId);
  const idx = state.order.indexOf(domId);
  if (idx >= 0) state.order.splice(idx, 1);
}

/**
 * Extract pending stream operations and build the wire payload.
 * Clears ops after extraction. Returns null if no streams have pending ops.
 */
export function extractStreamOps(
  assigns: Record<string, unknown>,
): Record<string, any> | null {
  const streams = getStreams(assigns);
  const payload: Record<string, any> = {};
  let hasOps = false;

  for (const name in streams) {
    const state = streams[name]!;
    if (state.ops.length === 0) continue;

    const result = buildStreamPayload(state);
    if (result) {
      payload[name] = result;
      hasOps = true;
    }
    // Clear ops after extraction
    state.ops = [];
  }

  return hasOps ? payload : null;
}

/** Build the wire payload for a single stream's pending operations. */
function buildStreamPayload(state: StreamState): Record<string, any> | null {
  let hasReset = false;
  const inserts: { id: string; html: string; at?: number }[] = [];
  const deletes: string[] = [];

  for (const op of state.ops) {
    switch (op.type) {
      case "reset":
        hasReset = true;
        inserts.length = 0;
        deletes.length = 0;
        break;
      case "insert": {
        const html = state.renderFn(op.item);
        const entry: { id: string; html: string; at?: number } = { id: op.domId, html };
        if (op.at === 0) entry.at = 0;
        inserts.push(entry);
        break;
      }
      case "delete":
        deletes.push(op.domId);
        break;
    }
  }

  const result: Record<string, any> = {};
  if (hasReset) result.reset = true;
  if (inserts.length > 0) result.inserts = inserts;
  if (deletes.length > 0) result.deletes = deletes;

  return Object.keys(result).length > 0 ? result : null;
}

/** Prune excess items when a stream exceeds its limit. */
function applyLimit(state: StreamState, insertAt: number): void {
  if (state.limit === null) return;

  while (state.order.length > state.limit) {
    // Prune from opposite end of insertion
    const pruneIdx = insertAt === 0 ? state.order.length - 1 : 0;
    const domId = state.order[pruneIdx]!;
    state.order.splice(pruneIdx, 1);
    state.items.delete(domId);
    state.ops.push({ type: "delete", domId });
  }
}

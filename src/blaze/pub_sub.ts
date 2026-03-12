/**
 * Blaze PubSub -- In-process topic-based publish/subscribe.
 *
 * Equivalent to Ignite.PubSub in the Elixir version.
 * Elixir uses Erlang :pg (process groups) for automatic cleanup.
 * We use a simple Map<topic, Set<callback>> with manual unsubscribe.
 *
 * Broadcasts exclude the sender -- the sender updates its own state
 * in handleEvent, while other subscribers receive via handleInfo.
 */

export type Subscriber = (message: unknown) => void;
export type BroadcastHook = (topic: string, message: unknown) => void;

const topics = new Map<string, Set<Subscriber>>();
let broadcastHook: BroadcastHook | null = null;

/** Subscribe a callback to a topic. */
export function subscribe(topic: string, callback: Subscriber): void {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic)!.add(callback);
}

/** Unsubscribe a callback from a topic. */
export function unsubscribe(topic: string, callback: Subscriber): void {
  const subs = topics.get(topic);
  if (subs) {
    subs.delete(callback);
    if (subs.size === 0) topics.delete(topic);
  }
}

/** Unsubscribe a callback from all topics. */
export function unsubscribeAll(callback: Subscriber): void {
  for (const [topic, subs] of topics) {
    subs.delete(callback);
    if (subs.size === 0) topics.delete(topic);
  }
}

/** Broadcast a message to all subscribers of a topic, excluding the sender. */
export function broadcast(
  topic: string,
  message: unknown,
  exclude?: Subscriber,
): void {
  const subs = topics.get(topic);
  if (!subs) return;
  for (const cb of subs) {
    if (cb !== exclude) cb(message);
  }
  // Notify cluster hook for cross-worker relay
  if (broadcastHook) broadcastHook(topic, message);
}

/**
 * Publish a message locally without triggering the cluster hook.
 * Used by cluster workers receiving relayed messages from other workers.
 */
export function publishLocal(topic: string, message: unknown): void {
  const subs = topics.get(topic);
  if (!subs) return;
  for (const cb of subs) {
    cb(message);
  }
}

/**
 * Register a hook called on every broadcast (for cluster IPC relay).
 */
export function onBroadcast(hook: BroadcastHook): void {
  broadcastHook = hook;
}

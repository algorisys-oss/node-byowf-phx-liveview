/**
 * Blaze Presence -- In-memory presence tracking with auto-cleanup.
 *
 * Equivalent to Ignite.Presence in the Elixir version.
 * Tracks which users are connected to which topics, broadcasts
 * join/leave diffs via PubSub, and auto-removes users when their
 * WebSocket connection closes.
 *
 * In Elixir, Process.monitor() detects process death automatically.
 * Here, we rely on explicit untrack() calls from the LiveHandler's
 * handleClose() callback.
 *
 * Usage:
 *   Presence.track("room:lobby", "user-123", { name: "Alice" });
 *   Presence.list("room:lobby"); // → { "user-123": { name: "Alice" } }
 *   Presence.untrack("room:lobby", "user-123");
 */

import * as PubSub from "./pub_sub.js";

export interface PresenceMeta {
  [key: string]: unknown;
}

export interface PresenceDiff {
  joins: Record<string, PresenceMeta>;
  leaves: Record<string, PresenceMeta>;
}

/**
 * Internal state: topic → (key → meta)
 * Each key represents a unique user/connection in that topic.
 */
const presences = new Map<string, Map<string, PresenceMeta>>();

/**
 * Reverse index: tracks which (topic, key) pairs belong to a given
 * PubSub subscriber callback. Used for auto-cleanup on disconnect.
 */
const subscriberKeys = new Map<PubSub.Subscriber, Array<{ topic: string; key: string }>>();

/**
 * Track a user's presence in a topic.
 *
 * @param topic - The presence topic (e.g., "presence:lobby")
 * @param key - Unique identifier for this user/connection
 * @param meta - Metadata about the user (name, joined_at, etc.)
 * @param subscriber - The PubSub subscriber for auto-cleanup tracking
 */
export function track(
  topic: string,
  key: string,
  meta: PresenceMeta,
  subscriber?: PubSub.Subscriber,
): void {
  if (!presences.has(topic)) presences.set(topic, new Map());
  const topicMap = presences.get(topic)!;

  topicMap.set(key, meta);

  // Track the association for auto-cleanup
  if (subscriber) {
    if (!subscriberKeys.has(subscriber)) subscriberKeys.set(subscriber, []);
    subscriberKeys.get(subscriber)!.push({ topic, key });
  }

  // Broadcast join diff
  const diff: PresenceDiff = {
    joins: { [key]: meta },
    leaves: {},
  };
  PubSub.broadcast(topic, { type: "presence_diff", diff });
}

/**
 * Remove a user's presence from a topic.
 *
 * @param topic - The presence topic
 * @param key - The user's unique key
 */
export function untrack(topic: string, key: string): void {
  const topicMap = presences.get(topic);
  if (!topicMap) return;

  const meta = topicMap.get(key);
  if (!meta) return;

  topicMap.delete(key);
  if (topicMap.size === 0) presences.delete(topic);

  // Broadcast leave diff
  const diff: PresenceDiff = {
    joins: {},
    leaves: { [key]: meta },
  };
  PubSub.broadcast(topic, { type: "presence_diff", diff });
}

/**
 * List all presences for a topic.
 *
 * @returns A map of key → meta for all tracked users in the topic
 */
export function list(topic: string): Record<string, PresenceMeta> {
  const topicMap = presences.get(topic);
  if (!topicMap) return {};

  const result: Record<string, PresenceMeta> = {};
  for (const [key, meta] of topicMap) {
    result[key] = meta;
  }
  return result;
}

/**
 * Remove all presence entries associated with a PubSub subscriber.
 * Called from handleClose() to auto-cleanup when a connection drops.
 *
 * This is the Node.js equivalent of Elixir's Process.monitor/:DOWN handling.
 */
export function untrackAll(subscriber: PubSub.Subscriber): void {
  const entries = subscriberKeys.get(subscriber);
  if (!entries) return;

  for (const { topic, key } of entries) {
    untrack(topic, key);
  }

  subscriberKeys.delete(subscriber);
}

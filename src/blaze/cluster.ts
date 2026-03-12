/**
 * Blaze Cluster -- Multi-core scaling with node:cluster.
 *
 * The primary process forks one worker per CPU core.
 * Each worker runs a full Blaze server (uWS handles port sharing via SO_REUSEPORT).
 * IPC messages relay PubSub broadcasts across workers for cross-process LiveView updates.
 */

import cluster from "node:cluster";
import { cpus } from "node:os";
import * as PubSub from "./pub_sub.js";

export interface ClusterOptions {
  /** Number of workers (default: number of CPU cores) */
  workers?: number;
}

/** IPC message format for cross-worker PubSub */
interface IPCMessage {
  type: "pubsub_broadcast";
  topic: string;
  message: unknown;
  fromWorker: number;
}

/**
 * Start the cluster: primary forks workers, workers call the callback.
 * Returns true if this is the primary (caller should NOT start server).
 * Returns false if this is a worker (caller SHOULD start server).
 */
export function startCluster(options: ClusterOptions = {}): boolean {
  const numWorkers = options.workers ?? cpus().length;

  if (cluster.isPrimary) {
    console.log(`[cluster] Primary ${process.pid} starting ${numWorkers} workers`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = cluster.fork();
      worker.on("message", (msg: IPCMessage) => {
        if (msg.type === "pubsub_broadcast") {
          // Relay to all OTHER workers
          for (const [id, w] of Object.entries(cluster.workers ?? {})) {
            if (w && w.id !== msg.fromWorker) {
              w.send(msg);
            }
          }
        }
      });
    }

    cluster.on("exit", (worker, code, signal) => {
      console.log(`[cluster] Worker ${worker.process.pid} died (${signal || code}), restarting...`);
      const newWorker = cluster.fork();
      newWorker.on("message", (msg: IPCMessage) => {
        if (msg.type === "pubsub_broadcast") {
          for (const [id, w] of Object.entries(cluster.workers ?? {})) {
            if (w && w.id !== msg.fromWorker) {
              w.send(msg);
            }
          }
        }
      });
    });

    return true; // This is primary — don't start server
  }

  // Worker process: set up IPC PubSub relay
  setupWorkerIPC();

  console.log(`[cluster] Worker ${process.pid} started`);
  return false; // This is a worker — start server
}

/**
 * Set up IPC message handling for PubSub relay in worker processes.
 * When a worker publishes to PubSub, relay to primary which fans out.
 * When receiving from primary, publish locally.
 */
function setupWorkerIPC(): void {
  // Hook into PubSub to broadcast across workers
  PubSub.onBroadcast((topic: string, message: unknown) => {
    if (process.send) {
      const msg: IPCMessage = {
        type: "pubsub_broadcast",
        topic,
        message,
        fromWorker: cluster.worker?.id ?? 0,
      };
      process.send(msg);
    }
  });

  // Receive broadcasts from other workers (via primary relay)
  process.on("message", (msg: IPCMessage) => {
    if (msg.type === "pubsub_broadcast") {
      PubSub.publishLocal(msg.topic, msg.message);
    }
  });
}

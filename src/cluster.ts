/**
 * Cluster entry point -- starts Blaze with one worker per CPU core.
 *
 * Usage: npx tsx src/cluster.ts
 * Or:    npm run cluster
 */

import { startCluster } from "./blaze/cluster.js";
import { serve } from "./blaze/server.js";
import { router, liveRoutes } from "./app.js";

const isPrimary = startCluster();

if (!isPrimary) {
  // Worker: start the server
  const ssl = process.env.SSL_KEY && process.env.SSL_CERT
    ? { keyFile: process.env.SSL_KEY, certFile: process.env.SSL_CERT }
    : undefined;
  serve({ port: 4001, router, liveRoutes, ssl });
}

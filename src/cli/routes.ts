#!/usr/bin/env npx tsx
/**
 * Route Listing CLI -- `npx tsx src/cli/routes.ts`
 *
 * Prints all registered routes (HTTP + LiveView) in a formatted table.
 * Equivalent to `mix phx.routes` in Phoenix.
 */

import { router, liveRoutes } from "../app.js";

// Print header
console.log("");
console.log("  Blaze Routes");
console.log("  " + "=".repeat(65));

// Print LiveView routes
const liveEntries = [...liveRoutes.keys()];
if (liveEntries.length > 0) {
  console.log("");
  console.log("  LiveView:");
  for (const path of liveEntries) {
    console.log(`    ${"GET".padEnd(8)} ${path.padEnd(30)} [LiveView/WebSocket]`);
  }
}

// Print HTTP routes
const httpRoutes = router.getRoutes();
if (httpRoutes.length > 0) {
  console.log("");
  console.log("  HTTP:");
  for (const r of httpRoutes) {
    const name = r.name ? `(${r.name})` : "";
    console.log(`    ${r.method.padEnd(8)} ${r.path.padEnd(30)} ${name}`);
  }
}

console.log("");
console.log(`  Total: ${liveEntries.length} LiveView + ${httpRoutes.length} HTTP = ${liveEntries.length + httpRoutes.length} routes`);
console.log("");

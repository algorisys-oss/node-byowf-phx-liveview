/**
 * Blaze Static -- Content-hashed static asset URLs.
 *
 * Equivalent to Ignite.Static in the Elixir version.
 * Computes MD5 hashes of files at boot time and provides
 * staticPath() for cache-busting query-string URLs.
 *
 * Example: staticPath("blaze.js") → "/public/blaze.js?v=a1b2c3d4"
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** In-memory manifest: filename → content hash */
const manifest = new Map<string, string>();

/**
 * Hash a file's contents using MD5, return first 8 hex chars.
 * MD5 is fine here — this is for cache busting, not security.
 */
function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

/**
 * Recursively walk a directory and collect all file paths.
 */
function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Build the manifest by hashing all files in the given directory.
 * Call at server boot time.
 */
export function buildManifest(publicDir: string): void {
  manifest.clear();
  try {
    statSync(publicDir);
  } catch {
    return; // Directory doesn't exist, nothing to hash
  }

  for (const filePath of walkDir(publicDir)) {
    const rel = relative(publicDir, filePath);
    const hash = hashFile(filePath);
    manifest.set(rel, hash);
  }
}

/**
 * Rebuild the manifest (e.g., when assets change in dev mode).
 */
export function rebuildManifest(publicDir: string): void {
  buildManifest(publicDir);
}

/**
 * Get a cache-busted URL for a static asset.
 *
 * staticPath("blaze.js") → "/public/blaze.js?v=a1b2c3d4"
 * staticPath("uploads/logo.png") → "/public/uploads/logo.png?v=e5f6g7h8"
 *
 * If the file isn't in the manifest, returns the plain URL.
 */
export function staticPath(filename: string): string {
  const hash = manifest.get(filename);
  if (hash) {
    return `/public/${filename}?v=${hash}`;
  }
  return `/public/${filename}`;
}

/**
 * Get the manifest entries (for debugging / route listing).
 */
export function getManifest(): Map<string, string> {
  return new Map(manifest);
}

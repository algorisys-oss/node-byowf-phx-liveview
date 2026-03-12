/**
 * Blaze CSRF -- Cross-Site Request Forgery protection.
 *
 * Equivalent to Ignite.CSRF in the Elixir version.
 * Generates per-session tokens, masks them for BREACH protection,
 * and validates on state-changing requests (POST, PUT, PATCH, DELETE).
 */

import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import type { Context } from "./context.js";

const TOKEN_BYTES = 32;

/** Generate a random CSRF token (stored in session). */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return toHex(bytes);
}

/**
 * Mask a CSRF token to prevent BREACH attacks.
 * Each masked token is unique even for the same underlying token.
 * Format: hex(mask) + hex(mask XOR token_bytes)
 */
export function maskToken(token: string): string {
  const tokenBytes = fromHex(token);
  const mask = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const masked = new Uint8Array(TOKEN_BYTES);
  for (let i = 0; i < TOKEN_BYTES; i++) {
    masked[i] = mask[i]! ^ tokenBytes[i]!;
  }
  return toHex(mask) + toHex(masked);
}

/**
 * Validate a masked CSRF token against the session token.
 * Returns true if the unmasked value matches.
 */
export function validateToken(maskedToken: string, sessionToken: string): boolean {
  if (!maskedToken || !sessionToken) return false;
  if (maskedToken.length !== TOKEN_BYTES * 4) return false; // 2 * 32 bytes in hex

  try {
    const mask = fromHex(maskedToken.slice(0, TOKEN_BYTES * 2));
    const masked = fromHex(maskedToken.slice(TOKEN_BYTES * 2));
    const unmasked = new Uint8Array(TOKEN_BYTES);
    for (let i = 0; i < TOKEN_BYTES; i++) {
      unmasked[i] = mask[i]! ^ masked[i]!;
    }
    // Use Node.js crypto timingSafeEqual for constant-time comparison
    const a = Buffer.from(toHex(unmasked));
    const b = Buffer.from(sessionToken);
    if (a.length !== b.length) return false;
    return cryptoTimingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Generate an HTML hidden input with a masked CSRF token. */
export function csrfTokenTag(ctx: Context): string {
  const token = ensureToken(ctx);
  const masked = maskToken(token);
  return `<input type="hidden" name="_csrf_token" value="${masked}" />`;
}

/** Get or generate the CSRF token for this session. */
export function ensureToken(ctx: Context): string {
  let token = ctx.session._csrf_token as string | undefined;
  if (!token) {
    token = generateToken();
    ctx.session._csrf_token = token;
  }
  return token;
}

/**
 * CSRF verification middleware.
 * Checks state-changing requests for a valid _csrf_token param.
 * Skips GET, HEAD, OPTIONS (safe methods).
 */
export function verifyCsrfToken(ctx: Context): Context {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(ctx.method)) return ctx;

  const sessionToken = ctx.session._csrf_token as string | undefined;
  const submittedToken = (ctx.body._csrf_token as string) ?? "";

  if (!sessionToken || !validateToken(submittedToken, sessionToken)) {
    ctx.setStatus(403)
      .setHeader("content-type", "text/html; charset=utf-8")
      .setBody("<h1>403 Forbidden</h1><p>Invalid CSRF token. Please refresh the page and try again.</p>")
      .halt();
  }

  return ctx;
}

// -- Helpers --

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

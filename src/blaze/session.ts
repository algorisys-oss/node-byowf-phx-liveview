/**
 * Blaze Session -- Signed cookie-based sessions.
 *
 * Equivalent to Ignite.Session in the Elixir version.
 * Session data lives in the cookie itself, signed with HMAC-SHA256
 * to prevent tampering. No server-side session store needed.
 *
 * Flash messages are stored in session._flash and popped on each request:
 *   putFlash(ctx, "info", "Saved!") → stored in session._flash
 *   redirect → next request reads _flash, then clears it
 */

import { createHmac, timingSafeEqual as tsEqual } from "node:crypto";

const COOKIE_NAME = "_blaze_session";
const DEFAULT_SECRET = "blaze-secret-key-change-in-prod-min-64-bytes-long-for-security!!";

let secretKey: string = process.env.SECRET_KEY_BASE ?? DEFAULT_SECRET;

/** Override the signing secret (for testing or config). */
export function setSecret(secret: string): void {
  secretKey = secret;
}

/** Get the session cookie name. */
export function cookieName(): string {
  return COOKIE_NAME;
}

/** Parse a Cookie header string into a key-value map. */
export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

/** Sign and encode a session map into a cookie value. */
export function encode(session: Record<string, unknown>): string {
  const payload = JSON.stringify(session);
  const payloadB64 = Buffer.from(payload).toString("base64");
  const signature = hmacSign(payloadB64);
  return `${payloadB64}.${signature}`;
}

/** Verify and decode a signed cookie value back into a session map. */
export function decode(cookieValue: string | undefined): Record<string, unknown> {
  if (!cookieValue) return {};

  const dotIdx = cookieValue.lastIndexOf(".");
  if (dotIdx < 0) return {};

  const payloadB64 = cookieValue.slice(0, dotIdx);
  const signature = cookieValue.slice(dotIdx + 1);

  const expected = hmacSign(payloadB64);
  if (!timingSafeEqual(signature, expected)) return {};

  try {
    const payload = Buffer.from(payloadB64, "base64").toString("utf-8");
    const parsed = JSON.parse(payload);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Compute HMAC-SHA256 of data using the secret key. */
function hmacSign(data: string): string {
  return createHmac("sha256", secretKey).update(data).digest("hex");
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return tsEqual(Buffer.from(a), Buffer.from(b));
}

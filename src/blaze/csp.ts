/**
 * Blaze CSP -- Content Security Policy headers.
 *
 * Generates per-request nonces for inline scripts and sets a strict CSP header.
 * Prevents XSS by only allowing scripts with the correct nonce.
 */

import type { Context } from "./context.js";

/** Generate a random nonce for this request. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Get or generate the CSP nonce for this request. */
export function getNonce(ctx: Context): string {
  let nonce = ctx.getPrivate("csp_nonce") as string | undefined;
  if (!nonce) {
    nonce = generateNonce();
    ctx.putPrivate("csp_nonce", nonce);
  }
  return nonce;
}

/**
 * CSP middleware: generates a nonce and sets the Content-Security-Policy header.
 * Use getNonce(ctx) in templates to add nonce="..." to script tags.
 */
export function cspMiddleware(ctx: Context): Context {
  const nonce = getNonce(ctx);

  const policy = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `connect-src 'self' ws: wss:`,
    `font-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");

  ctx.setHeader("content-security-policy", policy);
  return ctx;
}

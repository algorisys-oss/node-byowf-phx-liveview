/**
 * Blaze Controller -- Response helpers.
 *
 * Equivalent to Ignite.Controller in the Elixir version.
 * Functions that set the right status, content-type, and body
 * on a Context, then halt the pipeline.
 */

import type { Context } from "./context.js";
import { renderTemplate } from "./template.js";
export { csrfTokenTag, verifyCsrfToken } from "./csrf.js";
export { staticPath } from "./static.js";

export function text(ctx: Context, body: string, status: number = 200): Context {
  return ctx
    .setStatus(status)
    .setHeader("content-type", "text/plain")
    .setBody(body)
    .halt();
}

export function html(ctx: Context, body: string, status: number = 200): Context {
  return ctx
    .setStatus(status)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setBody(body)
    .halt();
}

export function json(ctx: Context, data: unknown, status: number = 200): Context {
  return ctx
    .setStatus(status)
    .setHeader("content-type", "application/json")
    .setBody(JSON.stringify(data))
    .halt();
}

export function redirect(ctx: Context, to: string, status: number = 302): Context {
  return ctx
    .setStatus(status)
    .setHeader("location", to)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setBody("")
    .halt();
}

/** Store a flash message for the next request (survives one redirect). */
export function putFlash(ctx: Context, key: string, message: string): Context {
  const flash = (ctx.session._flash ?? {}) as Record<string, string>;
  flash[key] = message;
  ctx.session._flash = flash;
  return ctx;
}

/** Get all flash messages from the current request. */
export function getFlash(ctx: Context): Record<string, string> {
  return (ctx.getPrivate("flash") ?? {}) as Record<string, string>;
}

/** Get a specific flash message by key. */
export function getFlashKey(ctx: Context, key: string): string | undefined {
  return getFlash(ctx)[key];
}

export async function render(
  ctx: Context,
  template: string,
  assigns: Record<string, unknown> = {},
): Promise<Context> {
  const body = await renderTemplate(template, assigns);
  return html(ctx, body);
}

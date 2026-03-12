/**
 * Blaze Router -- Route registration and matching.
 *
 * Equivalent to Ignite.Router in the Elixir version.
 * Function-based DSL instead of macros: router.get("/path", handler).
 * Segment-based matching with :param capture, middleware pipeline, and 404 fallback.
 */

import type { Context } from "./context.js";

export type Handler = (ctx: Context) => Context | Promise<Context>;
export type Middleware = (ctx: Context) => Context | Promise<Context>;

interface Route {
  method: string;
  path: string;
  segments: string[];
  handler: Handler;
  name?: string;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function matchRoute(
  routeSegments: string[],
  pathSegments: string[],
): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i]!;
    const pathSeg = pathSegments[i]!;

    if (routeSeg.startsWith(":")) {
      params[routeSeg.slice(1)] = pathSeg;
    } else if (routeSeg !== pathSeg) {
      return null;
    }
  }

  return params;
}

export class Router {
  private middlewares: Middleware[] = [];
  private routes: Route[] = [];
  private prefix: string = "";
  private namedRoutes = new Map<string, Route>();

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  scope(prefix: string, fn: (router: Router) => void): this {
    const prev = this.prefix;
    this.prefix = prev + prefix;
    fn(this);
    this.prefix = prev;
    return this;
  }

  private addRoute(method: string, path: string, handler: Handler, name?: string): this {
    const fullPath = this.prefix + path;
    const route: Route = { method, path: fullPath, segments: splitPath(fullPath), handler, name };
    this.routes.push(route);
    if (name) {
      this.namedRoutes.set(name, route);
    }
    return this;
  }

  get(path: string, handler: Handler, name?: string): this {
    return this.addRoute("GET", path, handler, name);
  }

  post(path: string, handler: Handler, name?: string): this {
    return this.addRoute("POST", path, handler, name);
  }

  put(path: string, handler: Handler, name?: string): this {
    return this.addRoute("PUT", path, handler, name);
  }

  patch(path: string, handler: Handler, name?: string): this {
    return this.addRoute("PATCH", path, handler, name);
  }

  delete(path: string, handler: Handler, name?: string): this {
    return this.addRoute("DELETE", path, handler, name);
  }

  pathFor(name: string, params: Record<string, string | number> = {}): string {
    const route = this.namedRoutes.get(name);
    if (!route) {
      throw new Error(`No route named "${name}"`);
    }

    const segments = route.segments.map((seg) =>
      seg.startsWith(":") ? String(params[seg.slice(1)] ?? seg) : seg,
    );

    return "/" + segments.join("/");
  }

  getRoutes(): { method: string; path: string; name?: string }[] {
    return this.routes.map((r) => ({ method: r.method, path: r.path, name: r.name }));
  }

  async call(ctx: Context): Promise<Context> {
    // Run middleware pipeline
    for (const mw of this.middlewares) {
      const result = mw(ctx);
      ctx = result instanceof Promise ? await result : result;
      if (ctx.halted) return ctx;
    }

    // Route dispatch
    const pathSegments = splitPath(ctx.path);

    for (const route of this.routes) {
      if (route.method !== ctx.method) continue;

      const params = matchRoute(route.segments, pathSegments);
      if (params) {
        ctx.params = params;
        const result = route.handler(ctx);
        return result instanceof Promise ? await result : result;
      }
    }

    // 404 fallback
    ctx.setStatus(404).setHeader("content-type", "text/plain").setBody("404 - Not Found");
    return ctx;
  }
}

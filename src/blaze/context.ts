/**
 * Blaze Context -- The request/response pipeline object.
 *
 * Equivalent to %Plug.Conn{} in Elixir / %Ignite.Conn{} in Ignite.
 * Transport-agnostic: accepts a ContextInit with pre-extracted request
 * data and a sendFn closure for writing the response.
 *
 * This design allows the same Context to work with node:http, uWebSockets.js,
 * or any other HTTP server — the transport details live in sendFn.
 */

export interface ContextInit {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  rawBody?: string;
  sendFn: (status: number, headers: Record<string, string>, body: string) => void;
}

export class Context {
  // -- Request fields (set once at creation) --
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly url: URL;
  readonly headers: Record<string, string>;

  // -- Params (filled by router) --
  params: Record<string, string> = {};

  // -- Cookies (filled by session middleware) --
  cookies: Record<string, string> = {};

  // -- Session (filled by session middleware, persisted to signed cookie) --
  session: Record<string, unknown> = {};

  // -- Request body (filled by parseBody()) --
  body: Record<string, unknown> = {};

  // -- Response fields (accumulated through pipeline) --
  status: number = 200;
  private _respHeaders: Record<string, string> = {};
  private _respBody: string = "";

  // -- Pipeline control --
  halted: boolean = false;

  // -- Framework-internal state (flash, csrf, etc.) --
  private _private: Record<string, unknown> = {};

  // -- Transport --
  private _rawBody: string;
  private _sendFn: (status: number, headers: Record<string, string>, body: string) => void;

  constructor(init: ContextInit) {
    this.method = init.method;
    this.path = init.path;
    this.query = init.query;
    this.headers = init.headers;
    this._rawBody = init.rawBody ?? "";
    this._sendFn = init.sendFn;

    // Build URL for compatibility (used by some middleware)
    const host = init.headers["host"] ?? "localhost";
    const qs = init.query ? `?${init.query}` : "";
    this.url = new URL(`${init.path}${qs}`, `http://${host}`);
  }

  // -- Response accumulation --

  setStatus(code: number): this {
    this.status = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this._respHeaders[name.toLowerCase()] = value;
    return this;
  }

  setBody(body: string): this {
    this._respBody = body;
    return this;
  }

  halt(): this {
    this.halted = true;
    return this;
  }

  // -- Private state (for framework internals) --

  putPrivate(key: string, value: unknown): this {
    this._private[key] = value;
    return this;
  }

  getPrivate(key: string): unknown {
    return this._private[key];
  }

  // -- Content negotiation --

  accepts(type: string): boolean {
    const accept = this.headers["accept"] ?? "*/*";
    return accept.includes(type) || accept.includes("*/*");
  }

  // -- Body parsing --

  async parseBody(): Promise<this> {
    const contentType = this.headers["content-type"] ?? "";

    if (contentType.includes("application/json")) {
      try {
        this.body = JSON.parse(this._rawBody) as Record<string, unknown>;
      } catch {
        this.body = {};
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(this._rawBody);
      const parsed: Record<string, unknown> = {};
      for (const [key, value] of params) {
        parsed[key] = value;
      }
      this.body = parsed;
    }

    return this;
  }

  // -- Send the response --

  send(): void {
    this._sendFn(this.status, this._respHeaders, this._respBody);
  }
}

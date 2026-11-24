/**
 * @file Dropped-upstream lifecycle for a development reverse proxy, over structural ports.
 *
 * A dev proxy that only pipes the upstream response into the browser's response never learns that
 * the upstream died mid-stream: `pipe` ends the response on `end`, but not on `close` or `error`,
 * and a proxy's own error handler usually answers only while headers are still unsent. So when the
 * upstream restarts under a watcher, a streaming response that already had its headers stays open
 * forever. The browser's `EventSource` never sees an error, never reconnects, and anything that
 * bound itself to the dead process keeps using it. Destroying the response surfaces the loss the
 * way the real server dying would when the browser talks to it directly.
 *
 * `destroy`, not `end`: `end` would finish a truncated body as if it were complete. Both
 * `http.ServerResponse` and `http2.Http2ServerResponse` have `destroy`, and on HTTP/2 it resets just
 * this stream, not the tab's whole multiplexed connection.
 *
 * Nothing here imports a server framework: the host passes its proxy object, which only has to
 * satisfy {@link ProxyEventsPort}, and supplies the refusal answer as data.
 */

/** The upstream response: only its `close` event is observed. */
export interface UpstreamResponsePort {
  on(event: 'close', listener: () => void): unknown;
}

/** The browser-facing response the proxy writes to. */
export interface ClientResponsePort {
  readonly writableEnded?: boolean;
  readonly headersSent?: boolean;
  destroy(): unknown;
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

/** The slice of the proxied request the error path reads. */
export interface ProxiedRequestPort {
  readonly headers: { readonly accept?: string | readonly string[] | undefined };
}

/** The proxy's event surface: a response from the upstream, and a failure reaching it. */
export interface ProxyEventsPort {
  on(event: 'proxyRes', listener: (upstream: UpstreamResponsePort, req: unknown, res: ClientResponsePort) => void): unknown;
  on(event: 'error', listener: (error: Error, req: ProxiedRequestPort, res: unknown) => void): unknown;
}

/** What the host answers with when the upstream refused the connection, so the request provably never ran. */
export interface UpstreamRefusal {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** A WebSocket upgrade hands the error listener a socket, which has no headers to check. */
function isClientResponse(res: unknown): res is ClientResponsePort {
  return typeof res === 'object' && res !== null && 'headersSent' in res;
}

function wantsEventStream({ req }: { req: ProxiedRequestPort }): boolean {
  return String(req.headers.accept ?? '').includes('text/event-stream');
}

/**
 * Install the dropped-upstream handling on `proxy`.
 *
 * - An upstream response that closes before the client response ended destroys the client response.
 *   `close` also follows a normal `end`, by which point `pipe` has already ended it.
 * - A failure to reach the upstream on an `EventSource` request drops the connection instead of
 *   answering it. An HTTP error status is final for `EventSource`, which then never reconnects once
 *   the upstream is back, while an unreachable server is something it keeps retrying. This listener
 *   must be registered before the proxy's own error listener, which then finds the response
 *   destroyed and writes nothing.
 * - Any other request refused with `ECONNREFUSED` gets the host's `refusal` answer: the request never
 *   reached the upstream, so even a write is safe to send again. Other errors (a reset mid-request)
 *   are left to the proxy's own handler, because that request may have run.
 * @param input.proxy - The host's proxy event emitter.
 * @param input.refusal - The host's answer for a refused connection.
 * @complexity O(1) per proxied response or error.
 */
export function installUpstreamCloseHandling({ proxy, refusal }: { proxy: ProxyEventsPort; refusal: UpstreamRefusal },
  _optional: Record<string, never> = {}): void {
  proxy.on('proxyRes', (upstream, _req, res) => {
    upstream.on('close', () => {
      if (!res.writableEnded) res.destroy();
    });
  });
  proxy.on('error', (error, req, res) => {
    if (!isClientResponse(res) || res.headersSent) return;
    if (wantsEventStream({ req })) {
      res.destroy();
      return;
    }
    if ((error as { code?: string }).code === 'ECONNREFUSED') {
      res.writeHead(refusal.status, refusal.headers);
      res.end(refusal.body);
    }
  });
}

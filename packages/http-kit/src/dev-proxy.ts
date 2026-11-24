import type { IncomingMessage, RequestOptions, ServerResponse } from "node:http";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { Socket } from "node:net";

/**
 * @file Proxies `<basePath>/*` to a frontend dev server (the host passes its URL as `devProxyUrl`;
 * this module reads no environment) so the browser never leaves this server's own origin — replacing
 * the 302-redirect dev-proxy mode a host's static-asset registration used to run.
 *
 * The redirect existed because a straight proxy has one hard problem: Vite's HMR client opens a
 * WebSocket, and an ordinary HTTP reverse proxy only ever sees `request` events, not the `upgrade`
 * event a WebSocket handshake arrives as. A redirect sidestepped that by putting the browser
 * directly on Vite's own origin, where its WS client needs no help. This module solves the problem
 * instead of avoiding it: {@link createDevProxyRequestHandler} forwards ordinary requests, and
 * {@link createDevProxyUpgradeListener} forwards the `upgrade` event so HMR keeps working through a
 * same-origin proxy. Verified against the installed Vite (7.3.6) source: with no `server.hmr.path`
 * override, its HMR client computes the socket URL as `<page origin><config.base>` — i.e. exactly
 * `/admin/` on whichever origin served the page — and its server-side `shouldHandle` gate matches
 * upgrades by that same base path, so proxying `/admin/*` (including the bare-path fix below) is
 * sufficient; no separate HMR-specific route is needed.
 */

/**
 * A TLS agent scoped to ONE dev-only upstream: Vite's own mkcert-issued certificate is
 * locally-trusted in the OS/browser store but not in Node's separate bundled CA list — the same gap
 * a Vite config's own `/api` proxy entries hit and fix with `secure: false`. Scoped to
 * this module's own outbound connections only; `NODE_TLS_REJECT_UNAUTHORIZED` is never touched, so
 * every other TLS connection this process makes (including real calls to third-party provider APIs)
 * keeps full certificate verification. `keepAlive` reuses one TLS connection across the many small
 * ESM module requests a Vite dev page issues, rather than a fresh handshake per file.
 */
function createDevUpstreamHttpsAgent(): HttpsAgent {
  return new HttpsAgent({ rejectUnauthorized: false, keepAlive: true });
}

/** Plain-HTTP counterpart for a boot with dev TLS disabled — kept for parity, not certificate-related. */
function createDevUpstreamHttpAgent(): HttpAgent {
  return new HttpAgent({ keepAlive: true });
}

/**
 * Rewrites a bare `/admin` request to `/admin/` before it reaches Vite. Vite's `base: "/admin/"`
 * only falls through to `index.html` on an exact base match, trailing slash included — a bare
 * `/admin` 404s at Vite itself. Mirrors the identical fix the redirect branch this module replaces
 * used to apply (`req.path === "/admin" ? "/admin/" : req.originalUrl`), rewritten to work directly
 * off a raw URL string so the same helper serves both the request proxy (which has `req.originalUrl`)
 * and the upgrade proxy (which only has the raw `req.url`).
 *
 * @param url - the incoming request's full path + query string.
 * @param basePath - the mount path the dev server serves under, without a trailing slash (e.g. `/admin`).
 * @complexity O(n) in `url`'s length (one indexOf, one slice).
 */
export function resolveDevProxyPath({ url, basePath }: { url: string; basePath: string }, _optional = {}): string {
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  if (pathname !== basePath) return url;
  return `${basePath}/${queryIndex === -1 ? "" : url.slice(queryIndex)}`;
}

/**
 * Hop-by-hop header names (RFC 7230 §6.1, plus `keep-alive`/`proxy-connection` which real servers
 * still send even though the RFC only names it as an example): meaningful only between this proxy
 * and the ONE upstream connection that produced them, never valid to relay verbatim to the actual
 * client on the other side of a proxy. Forwarding `connection` in particular used to merely be
 * sloppy under an HTTP/1.1-only client — under an HTTP/2 client (now possible: {@link
 * createDevProxyRequestHandler}'s `res` may be an HTTP/2 compat response once `index.ts`'s
 * listener negotiates `h2`) it is a hard failure: Node's http2 compatibility layer throws
 * `ERR_HTTP2_INVALID_CONNECTION_HEADER` the moment a `connection` header reaches `writeHead()`, and
 * Vite's own Node HTTP/1.1 server sets `Connection: keep-alive` on its responses by default — so
 * every proxied `/admin/*` response carried this header before the filter below was added.
 */
const HOP_BY_HOP_RESPONSE_HEADERS: ReadonlySet<string> = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "proxy-authenticate", "proxy-authorization", "trailer"]);

/**
 * Drops hop-by-hop headers (see {@link HOP_BY_HOP_RESPONSE_HEADERS}) from an upstream response
 * before it is relayed to the actual client. Node's `IncomingMessage.headers` keys are already
 * lower-cased, so a plain `Set` lookup is enough — no case-folding needed here.
 *
 * @complexity O(n) in the number of response headers.
 */
export function stripHopByHopHeaders({ headers }: { headers: IncomingMessage["headers"] }, _optional = {}): IncomingMessage["headers"] {
  const filtered: IncomingMessage["headers"] = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(name)) continue;
    filtered[name] = value;
  }
  return filtered;
}

/** One resolved upstream target: which `request()` function and agent to use for it. */
interface DevProxyUpstream {
  basePath: string;
  target: URL;
  requestFn: typeof httpRequest | typeof httpsRequest;
  agent: HttpAgent | HttpsAgent;
}

/** @complexity O(1). */
function resolveDevProxyUpstream({ devProxyUrl, basePath }: { devProxyUrl: string; basePath: string }, _optional = {}): DevProxyUpstream {
  const target = new URL(devProxyUrl);
  const isHttps = target.protocol === "https:";
  return {
    basePath,
    target,
    requestFn: isHttps ? httpsRequest : httpRequest,
    // One agent per proxy instance (not module state): the keep-alive pool lives and dies with its proxy.
    agent: isHttps ? createDevUpstreamHttpsAgent() : createDevUpstreamHttpAgent(),
  };
}

/** Shared request options both the ordinary and upgrade proxies send. */
function buildProxyRequestOptions(
  upstream: DevProxyUpstream,
  req: { method?: string | undefined; headers: IncomingMessage["headers"]; url: string }
): RequestOptions {
  return {
    hostname: upstream.target.hostname,
    port: upstream.target.port,
    // Host is rewritten to the upstream's own — Vite's dev server allowlists request hosts
    // (`server.allowedHosts`) and this keeps that check, and any base-URL logic Vite derives from
    // the Host header, seeing exactly what it would see when hit directly.
    headers: { ...req.headers, host: upstream.target.host },
    path: resolveDevProxyPath({ url: req.url, basePath: upstream.basePath }),
    method: req.method,
    agent: upstream.agent,
  };
}

/**
 * The host's reply when the upstream cannot be reached before any response head went out. The host
 * owns the status, content type and copy; this module only reports what failed. `Res` is the host's
 * own response type (an Express `Response` stays an Express `Response` inside the writer).
 * @returns Void; the writer must end `res`.
 */
export type DevProxyFailureWriter<Res extends ServerResponse = ServerResponse> = (args: { res: Res; error: Error; target: URL }) => void;

/**
 * Builds the Node request listener that proxies ordinary (non-WebSocket) `/admin/*` requests to Vite.
 * It speaks `IncomingMessage`/`ServerResponse` only, so any host (an Express `app.all`, a bare
 * `http.createServer`) can mount it.
 *
 * Streams both directions rather than buffering: `req` is piped straight into the upstream request,
 * and the upstream response is piped straight into `res`, so this scales to Vite's large module
 * bundles and source maps without holding them in memory.
 *
 * @param required.writeFailure - REQUIRED: the host's reply for an unreachable upstream (called only
 *   while `res.headersSent` is false; after the head went out the response is destroyed instead).
 * @complexity O(1) setup per request; the actual byte volume is bounded by whatever Vite serves.
 */
export function createDevProxyRequestHandler<Res extends ServerResponse = ServerResponse>(
  { devProxyUrl, basePath, writeFailure }: { devProxyUrl: string; basePath: string; writeFailure: DevProxyFailureWriter<Res> },
  _optional = {},
): (req: IncomingMessage, res: Res) => void {
  const upstream = resolveDevProxyUpstream({ devProxyUrl, basePath });

  return (req, res) => {
    const proxyReq = upstream.requestFn(buildProxyRequestOptions(upstream, { method: req.method, headers: req.headers, url: req.url ?? "" }), (proxyRes) => {
      // A client-side `IncomingMessage` handed to a `request()` response callback always carries the
      // parsed status line, so `statusCode` is set here (it is only optional on the server-side type).
      if (proxyRes.statusCode === undefined) {
        proxyRes.resume();
        proxyReq.destroy(new Error("admin dev proxy response has no status code"));
        return;
      }
      res.writeHead(proxyRes.statusCode, stripHopByHopHeaders({ headers: proxyRes.headers }));
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      writeFailure({ res, error, target: upstream.target });
    });
    req.pipe(proxyReq);
  };
}

/** Formats an upstream upgrade response's raw headers back into wire format for the client socket.
 *  The `upgrade` event only fires for a parsed `101` response, so its status code and reason phrase
 *  (possibly empty, never absent) are always present on the client-side `IncomingMessage`. */
function formatUpgradeResponseHead({ statusCode, statusMessage, rawHeaders }: { statusCode: number; statusMessage: string; rawHeaders: string[] }, _optional = {}): string {
  let headerLines = "";
  for (let i = 0; i < rawHeaders.length; i += 2) {
    headerLines += `${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`;
  }
  return `HTTP/1.1 ${statusCode} ${statusMessage}\r\n${headerLines}\r\n`;
}

/**
 * Makes `victim` go away once `terminator` does, in either direction — call it once per direction to
 * get full cross-destroy between two spliced sockets.
 *
 * Listens for `end` as well as `close`/`error`, which is the part easy to get wrong: `http.Server`
 * (and this proxy's own outbound `http.request`) sets `allowHalfOpen: true` on its sockets, so a
 * plain graceful disconnect (the common case — a browser tab closing, `curl` exiting) only ever
 * delivers `end`, never `close`, to the OTHER side. `.destroy()` is idempotent (a no-op past the
 * first call), so listening for all three and calling it from each is safe even when more than one
 * fires for the same disconnect.
 *
 * Confirmed live: without the `end` listener specifically, a real test of this exact tunnel hung
 * forever on teardown — the peer socket sat there fully disconnected but never noticed.
 */
function destroyOnTermination(terminator: Socket, victim: Socket): void {
  const destroyVictim = () => victim.destroy();
  terminator.on("end", destroyVictim);
  terminator.on("close", destroyVictim);
  terminator.on("error", destroyVictim);
}

/**
 * Pipes one client `upgrade` request through to the matching upstream connection, splicing the two
 * raw sockets together for the rest of the connection's life. This is the piece an ordinary HTTP
 * reverse proxy does not provide for free — `req`/`res` proxying only ever sees `request` events,
 * never `upgrade` — and it is what makes Vite's HMR WebSocket survive a same-origin `/admin/*` proxy.
 *
 * Any bytes the client sent immediately after its handshake (`head`) are forwarded on to the
 * upstream socket, and any the upstream sent immediately after its 101 response (`proxyHead`) are
 * forwarded on to the client socket, before the bidirectional pipe takes over — both are empty in
 * the overwhelmingly common case (a clean WebSocket handshake with no immediately-following frame)
 * but dropping them silently would corrupt the stream on the rare case they are not.
 *
 * @complexity O(1) setup; the connection then runs as a plain byte pipe for its lifetime.
 */
function proxyDevUpgrade({ upstream, req, url, clientSocket, head }: { upstream: DevProxyUpstream; req: IncomingMessage; url: string; clientSocket: Socket; head: Buffer }, _optional = {}): void {
  const proxyReq = upstream.requestFn(buildProxyRequestOptions(upstream, { method: req.method, headers: req.headers, url }));

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    if (proxyRes.statusCode === undefined || proxyRes.statusMessage === undefined) {
      proxySocket.destroy();
      clientSocket.destroy(new Error("admin dev proxy upgrade response has no status line"));
      return;
    }
    clientSocket.write(formatUpgradeResponseHead({ statusCode: proxyRes.statusCode, statusMessage: proxyRes.statusMessage, rawHeaders: proxyRes.rawHeaders }));
    if (proxyHead.length > 0) clientSocket.write(proxyHead);
    if (head.length > 0) proxySocket.write(head);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
    // Neither `.pipe()` above nor a graceful half-close tears down the OTHER socket on its own (see
    // `destroyOnTermination`'s own doc) — without this, one side going away leaves the other leg of
    // the tunnel, a real TCP socket held open to Vite or to the browser, dangling forever.
    destroyOnTermination(proxySocket, clientSocket);
    destroyOnTermination(clientSocket, proxySocket);
  });
  proxyReq.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => proxyReq.destroy());
  proxyReq.end();
}

/** The URL of an `upgrade` request this proxy claims (a present URL under `basePath`), else `undefined`. @complexity O(1). */
function claimedUpgradeUrl({ req, basePath }: { req: IncomingMessage; basePath: string }, _optional = {}): string | undefined {
  return req.url?.startsWith(basePath) === true ? req.url : undefined;
}

/**
 * Builds the `upgrade` listener that makes Vite's HMR WebSocket work through the dev proxy — see
 * this file's module doc for why an ordinary request proxy cannot provide this on its own.
 *
 * The host attaches the returned listener to the actual `http.Server`/`https.Server` instance (not
 * the Express `app`): `upgrade` is a socket-level server event Express's own request routing never
 * sees. Whether to attach it at all (dev-proxy URL configured, not a packaged build) is the host's
 * decision — this module reads no environment.
 *
 * Only claims upgrade requests whose path starts with `basePath`; anything else is left alone (no
 * `socket.destroy()`) so a future unrelated `upgrade` listener on the same server is not pre-empted.
 *
 * @complexity O(1) setup; the listener is O(1) per upgrade request.
 */
export function createDevProxyUpgradeListener(
  { devProxyUrl, basePath }: { devProxyUrl: string; basePath: string },
  _optional = {}
): (req: IncomingMessage, socket: Socket, head: Buffer) => void {
  const upstream = resolveDevProxyUpstream({ devProxyUrl, basePath });
  return (req, socket, head) => {
    // Only `<basePath>*` upgrades are claimed, so the URL is known to be present past this check.
    const url = claimedUpgradeUrl({ req, basePath });
    if (url === undefined) return;
    proxyDevUpgrade({ upstream, req, url, clientSocket: socket, head });
  };
}

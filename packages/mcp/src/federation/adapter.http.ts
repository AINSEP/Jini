import type { FederationMessages } from "./messages.js";
import type { McpToolCallRequiredArgs, McpToolCallOptions, McpHttpRequestRequiredArgs, McpHttpRequestOptions } from "./ports.js";
import {
  buildInitializeParams,
  CLIENT_PROTOCOL_VERSION,
  drainToolsList,
  type JsonRpcResponse,
  McpAuthFailedError,
  McpProtocolError,
  parseCallToolResult,
  parseInitializeResult,
} from "./mcp-protocol.js";
import type { McpHttpExchange, McpHttpLaunchSpec, McpHttpResponse, McpSessionPort, RemoteToolDescriptor, RemoteToolResult, McpClientInfo } from "./ports.js";

/**
 * @file The second real `McpSessionPort` adapter: an MCP client speaking JSON-RPC 2.0 over MCP's
 * Streamable HTTP transport, which is how every HOSTED MCP server is reached.
 *
 * Why this exists, given `adapter.stdio.ts` already federates:
 * stdio requires a program on the operator's own disk. A hosted server — Higgsfield, Supabase's
 * `https://mcp.supabase.com/mcp`, anything SaaS — has no such program, and the only way to reach it
 * is an authenticated HTTPS endpoint. `external-mcp-server-federation.md` deferred this transport
 * with a specific, now-expired reason: "OAuth needs an interactive browser consent flow and a token
 * store, neither of which host app has". `src/platform/oauth/` and `assistant/external-mcp-oauth.ts` are both of
 * those, so the blocker is gone and, exactly as that doc predicted, this lands as an added adapter
 * rather than a redesign.
 *
 * How much of Streamable HTTP is implemented, and what is deliberately left out:
 * the client-initiated half — POST a request, read the response, carry `Mcp-Session-Id` forward. A
 * server may answer either with `application/json` (one response) or `text/event-stream` (the same
 * response, SSE-framed); both are handled, because which one a server picks is its choice and not
 * something an operator configures.
 *
 * NOT implemented, on purpose: the standalone `GET` stream that lets a server push requests to the
 * client unprompted. That channel exists to carry server-to-client calls — `sampling/createMessage`
 * above all, a remote asking host app to run model inference on its behalf. `adapter.stdio.ts` answers
 * those with "method not found"; here the stronger move is available, so this client simply never
 * opens the channel they would arrive on. host app advertises no capabilities in `initialize`, so there
 * is nothing a server may legitimately push. Resumability (`Last-Event-ID`) goes with it: this
 * client makes bounded request/response calls, and `trust.ts` R5 freezes the admitted tool set at
 * connect, so there is no long-lived stream whose position would need restoring.
 *
 * Hostile-server posture (this file's share; `trust.ts` owns the rest):
 * every request is timeout-bounded by an `AbortSignal` the caller cannot lose, a response body is
 * length-bounded before it is parsed, a non-2xx is a typed error rather than a parse attempt, and
 * the session id a server hands back is validated before it is echoed into any later request
 * header — an unvalidated one is a header-injection primitive handed to the remote.
 *
 * Architectural role:
 * Infrastructure adapter, co-located with its port. Protocol logic it shares with the stdio adapter
 * lives in `mcp-protocol.ts`; what is here is HTTP, and only HTTP.
 */

/** Bound on one response body, matching `adapter.stdio.ts`'s per-message cap. A server that streams
 * an unbounded body would otherwise grow this process's heap without limit. `trust.ts` caps what
 * reaches a MODEL, but that runs after parsing, so parsing needs its own bound. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * What a server's `Mcp-Session-Id` may contain before this client will echo it back.
 *
 * The spec says visible ASCII (0x21..0x7E). Enforced rather than trusted because this value goes
 * straight into an outbound request header: a server answering with a session id containing CR or
 * LF would, against a naive HTTP client, be able to inject additional headers into every subsequent
 * request host app makes to it. Bounded in length for the same reason a body is.
 */
const SESSION_ID_PATTERN = /^[\x21-\x7e]{1,512}$/;

/** MCP requires a client to accept both response modes on every request, and the server picks. */
const ACCEPT_BOTH = "application/json, text/event-stream";

/** Wires `controller` to also abort when `callerSignal` does — including firing immediately if
 *  `callerSignal` is already aborted by the time this runs. Returns the listener so the caller can
 *  remove it again once the request settles. Split out of
 *  {@link McpHttpSession.postWithTimeout} purely to keep that method under the shop complexity
 *  ceiling; behavior is unchanged. */
function forwardAbort(controller: AbortController, callerSignal: AbortSignal | undefined): () => void {
  const onCallerAbort = (): void => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  if (callerSignal?.aborted) controller.abort();
  return onCallerAbort;
}

/** Builds the right {@link McpProtocolError} for a failed POST — distinguishing "the caller
 *  cancelled" from "the request timed out" from "the network/transport itself failed". Split out
 *  of {@link McpHttpSession.postWithTimeout} purely to keep that method under the shop complexity
 *  ceiling; behavior (including the exact message text) is unchanged. */
function buildPostFailureError(params: { error: unknown; timedOut: boolean; callerAborted: boolean; requestTimeoutMs: number }): McpProtocolError {
  if (params.timedOut) {
    return new McpProtocolError(
      { message: params.callerAborted ? "mcp-federation: the request was aborted" : `mcp-federation: the request timed out after ${params.requestTimeoutMs}ms` },
    );
  }
  return new McpProtocolError({ message: `mcp-federation: the request failed — ${params.error instanceof Error ? params.error.message : String(params.error)}` });
}

/**
 * A connected MCP client session against one hosted server.
 *
 * Constructed by {@link connectMcpHttpSession} rather than directly, so a session that exists is
 * always one whose handshake completed — mirroring `adapter.stdio.ts`, and for the same reason:
 * there is no half-initialized state a caller could accidentally use.
 */
/** Supplies a current token per exchange. Undefined preserves configured headers. */
export type McpBearerTokenSupplier = (request: { readonly url: string }, options?: { readonly signal?: AbortSignal | undefined }) => string | undefined | Promise<string | undefined>;
/** Notifies the host of a 401, including its authentication challenge. No OAuth flow or retry here. */
export type McpAuthenticationChallengeHook = (request: {
  readonly url: string;
  readonly status: 401;
  readonly wwwAuthenticate: string | undefined;
}, options?: { readonly signal?: AbortSignal | undefined }) => void | Promise<void>;
export interface McpHttpSessionDependencies {
  readonly messages: FederationMessages;
  readonly exchange: McpHttpExchange;
  readonly spec: McpHttpLaunchSpec;
  readonly requestTimeoutMs: number;
  readonly clientInfo: McpClientInfo;
  readonly bearerToken: McpBearerTokenSupplier;
  readonly onAuthenticationChallenge?: McpAuthenticationChallengeHook | undefined;
  /** Observer failures use the host's logger; diagnostics never replace an authentication error. */
  readonly logger?: { warn(required: { message: string }): void } | undefined;
}

class McpHttpSession implements McpSessionPort {
  private readonly messages: FederationMessages;
  private readonly exchange: McpHttpExchange;
  private readonly spec: McpHttpLaunchSpec;
  private readonly requestTimeoutMs: number;
  private readonly clientInfo: McpClientInfo;
  private readonly bearerToken: McpBearerTokenSupplier;
  private readonly onAuthenticationChallenge: McpAuthenticationChallengeHook | undefined;
  private readonly logger: McpHttpSessionDependencies["logger"];
  private nextId = 1;
  private sessionId: string | null = null;
  private closed = false;

  /** The protocol version the SERVER said it would speak, for diagnostics. */
  public serverProtocolVersion = "";
  /** The server's self-reported identity, for diagnostics and audit. Untrusted, like everything
   * else it sends — recorded, never acted on. */
  public serverInfo: { name?: string | undefined; version?: string | undefined } = {};

  constructor(deps: McpHttpSessionDependencies) {
    this.messages = deps.messages;
    this.exchange = deps.exchange;
    this.clientInfo = deps.clientInfo;
    this.bearerToken = deps.bearerToken;
    this.onAuthenticationChallenge = deps.onAuthenticationChallenge;
    this.logger = deps.logger;
    this.spec = deps.spec;
    this.requestTimeoutMs = deps.requestTimeoutMs;
  }

  /**
   * @complexity O(p) in `tools/list` pages, bounded by `mcp-protocol.ts`'s page cap.
   */
  async listTools(): Promise<RemoteToolDescriptor[]> {
    return drainToolsList({ requestPage: ({ params }) => this.request("tools/list", params) });
  }

  /**
   * @complexity O(1) beyond the remote's own round-trip.
   */
  async callTool(request: McpToolCallRequiredArgs, options: McpToolCallOptions = {}): Promise<RemoteToolResult> {
    return parseCallToolResult({ result: await this.request("tools/call", { name: request.name, arguments: request.arguments }, options.signal) });
  }

  /**
   * Marks the session closed and tells the server to drop it, best-effort.
   *
   * The DELETE is best-effort by design: a server is entitled to refuse it (the spec allows 405),
   * and a hosted server being unreachable at shutdown must not throw out of a caller that is only
   * tidying up. Local state is cleared either way, so a closed session refuses further requests
   * whatever the server did.
   */
  async close(_required: Record<string, never>): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId === null) return;
    const sessionId = this.sessionId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<void>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(); }, this.requestTimeoutMs);
    });
    try {
      // Bound credential lookup as well as DELETE. A non-cooperative port must not hold shutdown
      // open, and a late credential result must never dispatch a request after the deadline.
      const deleting = Promise.resolve().then(async () => {
        const headers = await this.authenticatedHeaders(this.baseHeaders(), controller.signal);
        if (controller.signal.aborted) return;
        await this.exchange.send({ url: this.spec.url, method: "DELETE", headers: { ...headers, "mcp-session-id": sessionId } }, { signal: controller.signal });
      }).catch(() => undefined);
      await Promise.race([deleting, expired]);
    } finally {
      clearTimeout(timer);
      this.sessionId = null;
    }
  }

  /** Sends the handshake. Separate from the constructor because it is the one part that can fail,
   *  and a session object that exists must be one that completed it. */
  async initialize(): Promise<void> {
    const identity = parseInitializeResult({ result: await this.request("initialize", buildInitializeParams({ clientInfo: this.clientInfo })) });
    this.serverProtocolVersion = identity.protocolVersion;
    this.serverInfo = identity.info;
    // MCP requires this notification after a successful initialize, and requires that a
    // notification carry no `id`. Its response carries no body to correlate — a 202 is the
    // expected outcome — so unlike every other call it is sent without awaiting a JSON-RPC result.
    await this.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  }

  /** Headers common to every request. Built fresh per call so a session id acquired mid-flight is
   *  picked up by the next request without mutating the operator's configured header bag. */
  private baseHeaders(): Record<string, string> {
    return {
      ...this.spec.headers,
      "content-type": "application/json",
      accept: ACCEPT_BOTH,
      // Required from the negotiated version onward, and harmless before it. Sent on every request
      // so a stateless server load-balanced across instances sees it on the one that handles a
      // given call, not only on the one that handled `initialize`.
      "mcp-protocol-version": this.serverProtocolVersion || CLIENT_PROTOCOL_VERSION,
    };
  }

  /** POSTs one JSON-RPC frame and returns the raw response, applying the timeout and recording any
   *  session id the server issues. */
  private async send(body: string, signal?: AbortSignal | undefined): Promise<McpHttpResponse> {
    if (this.closed) throw new McpProtocolError({ message: "mcp-federation: session is closed" });

    const headers = this.baseHeaders();
    if (this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;

    const response = await this.postWithTimeout(body, headers, signal);
    // A known auth failure must reach assertOkStatus even if the remote supplied a bad session id.
    if (response.status === 401) return response;
    this.adoptSessionId(response);
    return response;
  }

  /**
   * Applies the per-request ceiling.
   *
   * The timeout is enforced with an `AbortSignal` this method owns rather than by racing a promise:
   * a race leaves the underlying request running after the loser settles, and an abandoned request
   * against a hosted server still holds a socket and still delivers its body. Aborting cancels the
   * work as well as the wait.
   */
  private async postWithTimeout(body: string, headers: Record<string, string>, callerSignal?: AbortSignal | undefined): Promise<McpHttpResponse> {
    const controller = new AbortController();
    const onCallerAbort = forwardAbort(controller, callerSignal);

    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.exchange.send({ url: this.spec.url, method: "POST", headers: await this.authenticatedHeaders(headers, controller.signal) }, { body, signal: controller.signal });
      if (response.status === 401) await this.notifyAuthenticationChallenge({ response, signal: controller.signal });
      return response;
    } catch (error) {
      throw buildPostFailureError({
        error,
        timedOut: controller.signal.aborted,
        callerAborted: callerSignal?.aborted === true,
        requestTimeoutMs: this.requestTimeoutMs,
      });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** Observes a 401 within the POST's remaining budget, without superseding its typed auth error.
   * @complexity O(1) beyond the injected hook's work, bounded by the request signal.
   */
  private async notifyAuthenticationChallenge({ response, signal }: { response: McpHttpResponse; signal: AbortSignal }): Promise<void> {
    const hook = this.onAuthenticationChallenge;
    if (!hook || signal.aborted) return;
    let onAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // Keep the POST's timer and caller listener alive. Forward cancellation to cooperative hooks,
      // but also bound the wait for a hook that ignores it. Consume even a late rejection so the
      // observer can never hide McpAuthFailedError from the registration's auth-revocation handler.
      const notified = Promise.resolve().then(() => hook({
        url: this.spec.url, status: 401, wwwAuthenticate: response.wwwAuthenticate,
      }, { signal })).catch(() => {
        try {
          this.logger?.warn({ message: "mcp-federation: authentication challenge hook failed" });
        } catch {
          // Logging is another observer; a broken logger cannot replace the authentication error.
        }
      });
      await Promise.race([notified, aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** Resolves fresh credentials without mutating the configured header bag.
   * @complexity O(h) in configured headers, plus the injected supplier's work.
   */
  private async authenticatedHeaders(headers: Record<string, string>, signal?: AbortSignal | undefined): Promise<Record<string, string>> {
    const token = await this.bearerToken({ url: this.spec.url }, { signal });
    if (token === undefined) return headers;
    const authenticated = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"));
    return { ...authenticated, authorization: `Bearer ${token}` };
  }

  /** Records a server-issued session id, refusing one that could not safely be echoed back. */
  private adoptSessionId(response: McpHttpResponse): void {
    const issued = response.sessionId;
    if (issued === undefined || issued === "" || this.sessionId !== null) return;
    if (!SESSION_ID_PATTERN.test(issued)) {
      throw new McpProtocolError({ message: "mcp-federation: the server issued an Mcp-Session-Id containing characters that are not safe to send back" });
    }
    this.sessionId = issued;
  }

  /** Issues one JSON-RPC request and returns its `result`.
   *  @throws {McpProtocolError} On a transport failure, a non-2xx, an unparseable body, or a
   *  JSON-RPC error frame. */
  private async request(method: string, params: Record<string, unknown>, signal?: AbortSignal | undefined): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal);
    assertOkStatus(method, response, this.messages);

    const frame = extractJsonRpcFrame(method, response);
    if (frame.error) {
      throw new McpProtocolError(
        { message: `mcp-federation: remote returned JSON-RPC error ${frame.error.code ?? "?"}: ${frame.error.message ?? "(no message)"}` },
      );
    }
    return frame.result;
  }
}

/**
 * Turns a non-2xx into a message an operator can act on.
 *
 * Only 401 is called out by name, and by TYPE (`McpAuthFailedError`): it is the one status with a
 * specific cause and a specific fix — the connection's OAuth token has expired or been revoked, and
 * the row needs reconnecting. `external-mcp-store.ts` already reports that state at boot; this is
 * the same finding arrived at from the other direction, when a token that was valid at boot stops
 * being valid mid-session — this module has no OAuth knowledge of its own, so it only distinguishes
 * the failure; `mcp-federation/registrations.ts`'s `onAuthFailed` hook is what a caller that DOES
 * know what "reconnect" means reacts to it with.
 *
 * 403 is deliberately NOT treated the same: it means the token was accepted but the server refused
 * this particular request anyway (an out-of-scope tool, an unauthorized action) — a fact about this
 * call, not about the token's validity. Reporting it as `McpAuthFailedError` would make
 * `onAuthFailed` clear an otherwise-good token and force a needless reauth. It falls through to the
 * generic branch below, same as any other non-2xx whose cause is not "the token expired".
 */
function assertOkStatus(method: string, response: McpHttpResponse, messages: FederationMessages): void {
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401) {
    throw new McpAuthFailedError(
      { message: messages.authenticationRefused({ method, status: response.status }) },
    );
  }
  throw new McpProtocolError({ message: `mcp-federation: the server answered '${method}' with HTTP ${response.status}` });
}

/**
 * Pulls the JSON-RPC frame out of whichever response mode the server chose.
 *
 * @throws {McpProtocolError} On an oversized body, a body carrying no frame, or one that does not
 * parse.
 * @complexity O(n) in the body length.
 */
function extractJsonRpcFrame(method: string, response: McpHttpResponse): JsonRpcResponse {
  if (Buffer.byteLength(response.text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new McpProtocolError({ message: `mcp-federation: the server's response to '${method}' exceeded ${MAX_RESPONSE_BYTES} bytes` });
  }

  const payload = response.contentType.startsWith("text/event-stream") ? firstSseData(response.text) : response.text.trim();
  if (payload === null || payload === "") {
    throw new McpProtocolError({ message: `mcp-federation: the server's response to '${method}' carried no JSON-RPC message` });
  }

  try {
    return JSON.parse(payload) as JsonRpcResponse;
  } catch {
    throw new McpProtocolError({ message: `mcp-federation: the server's response to '${method}' was not valid JSON` });
  }
}

/**
 * The first SSE `data:` payload in a stream, or `null`.
 *
 * Only the first is taken, and deliberately: a server may interleave progress notifications before
 * the response, but this client issues one request at a time and wants the frame answering it.
 * Multi-line `data:` fields are joined with newlines per the SSE spec, since a server is entitled
 * to split a long JSON body across them.
 *
 * @complexity O(n) in the body length.
 */
function firstSseData(body: string): string | null {
  const collected: string[] = [];

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    if (rawLine.startsWith("data:")) {
      collected.push(rawLine.slice("data:".length).replace(/^ /, ""));
      continue;
    }
    // A blank line ends an event. Anything collected so far is that event's complete payload.
    if (rawLine.trim() === "" && collected.length > 0) return collected.join("\n");
  }

  return collected.length > 0 ? collected.join("\n") : null;
}

/**
 * Performs the MCP handshake against a hosted server and returns the connected session.
 *
 * @param deps.exchange - The transport seam. {@link createFetchMcpHttpExchange} in production, a
 * scripted double in tests.
 * @param deps.spec - Endpoint and authenticating headers.
 * @param deps.requestTimeoutMs - Per-request ceiling, applied to the handshake too.
 * @throws {McpProtocolError} If `initialize` fails, times out, or the server refuses it.
 * @complexity O(1) beyond the remote's round-trip.
 */
export async function connectMcpHttpSession(deps: Omit<McpHttpSessionDependencies, "onAuthenticationChallenge" | "logger">, options: Pick<McpHttpSessionDependencies, "onAuthenticationChallenge" | "logger"> = {}): Promise<McpSessionPort> {
  const session = new McpHttpSession({ ...deps, ...options });
  try {
    await session.initialize();
  } catch (error) {
    // A failed handshake may still have been issued a session id the server is now holding open.
    await session.close({}).catch(() => undefined);
    throw error;
  }
  return session;
}

/**
 * The production {@link McpHttpExchange}: one `fetch` per exchange.
 *
 * Deliberately logic-free — the same discipline as `spawnMcpStdioChannel`. Everything above it is
 * already under test through the exchange seam, and code that only runs when a real network exists
 * is code that only fails in production.
 *
 * `redirect: "error"` is the security-relevant choice, and matches `src/platform/oauth/token-endpoint.ts`:
 * these requests carry a bearer token in a header, and a followed cross-origin redirect would
 * re-send that header to whatever host the server nominated. Refusing to follow means a redirect is
 * a visible failure rather than a silent credential disclosure.
 *
 * @complexity O(n) in the response body length.
 */
export function createFetchMcpHttpExchange({ fetch: fetchImpl }: { fetch: typeof fetch }): McpHttpExchange {
  return {
    async send(request, options = {}) {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: { ...request.headers },
        ...(options.body === undefined ? {} : { body: options.body }),
        redirect: "error",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });

      return {
        status: response.status,
        contentType: (response.headers.get("content-type") ?? "").toLowerCase(),
        sessionId: response.headers.get("mcp-session-id") ?? undefined,
        wwwAuthenticate: response.headers.get("www-authenticate") ?? undefined,
        text: await response.text(),
      };
    },
  };
}

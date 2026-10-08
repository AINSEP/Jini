import type { FederationMessages } from "../messages.js";
import type { McpToolCallRequiredArgs, McpToolCallOptions, McpHttpRequestRequiredArgs, McpHttpRequestOptions } from "../ports.js";
import type { McpHttpExchange, McpHttpResponse, McpSessionPort, McpStdioChannel, RemoteToolDescriptor, RemoteToolResult } from "../ports.js";

/**
 * @file The in-memory doubles for both federation seams — rule-of-two's partner to
 * `adapter.stdio.ts`, and this codebase's usual `repo.memory.ts`/`repo.sqlite.ts` split applied to
 * an outbound protocol boundary instead of a database.
 *
 * One double per seam (see `ports.ts`), and they test different things:
 *
 * - {@link InMemoryMcpSession} fakes `McpSessionPort`, i.e. "an MCP server exists and behaves". It
 * is what `registrations.ts`'s tests use, so the trust tier and the registration wiring are
 * exercised with no protocol in the picture at all.
 *
 * - {@link ScriptedMcpStdioChannel} fakes `McpStdioChannel`, i.e. raw newline-delimited JSON-RPC.
 * It is what `adapter.stdio.ts`'s OWN tests use, so the real client's handshake ordering,
 * pagination, id correlation, timeout and close behaviour are exercised against something that
 * can also misbehave on purpose — reply out of order, reply late, reply twice, never reply,
 * send an unsolicited request, or die mid-flight.
 *
 * - {@link ScriptedMcpHttpExchange} does the same for `McpHttpExchange`, the hosted transport's
 * seam, so `adapter.http.ts` is under test on the same terms.
 *
 * Those inner-seam doubles are the ones that make the "no live third-party server in this sandbox"
 * constraint survivable: the protocol code under test is the real production code, and only the
 * pipe beneath it is fake. A double at the outer seam alone would have proved only that the double
 * works.
 *
 * Architectural role:
 * Test doubles. Ships in `src/` beside the port they implement, exactly as every feature's
 * `repo.memory.ts` does, so they are importable from `__tests__/` without a second tsconfig.
 * See docs/decisions/DR-003-trusted-federation-composition.md.
 */

/**
 * A scripted `McpSessionPort`: a fixed tool list plus a per-tool call handler.
 *
 * `callTool` records every call, so a test can assert not just the returned value but that the
 * REMOTE NAME was sent — the property that proves namespacing is applied on the way in and stripped
 * on the way out, which is the single most load-bearing behaviour in the registration layer.
 */
export class InMemoryMcpSession implements McpSessionPort {
  readonly calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  closed = false;

  private readonly tools: RemoteToolDescriptor[];
  private readonly handler: (required: { name: string; args: Record<string, unknown> }, options: McpToolCallOptions) => RemoteToolResult | Promise<RemoteToolResult>;
  private readonly listToolsBehaviour: (() => Promise<RemoteToolDescriptor[]>) | undefined;

  constructor({ tools }: { tools: readonly RemoteToolDescriptor[] }, options: {
    /** Defaults to echoing the call back, which is enough for most wiring assertions.
     * The injected remote receives the same optional cancellation object as a real session. */
    onCall?: ((required: { name: string; args: Record<string, unknown> }, options?: McpToolCallOptions) => RemoteToolResult | Promise<RemoteToolResult>) | undefined;
    /** Overrides `listTools` wholesale, for the "the remote is down at connect time" cases. */
    onListTools?: (() => Promise<RemoteToolDescriptor[]>) | undefined;
  } = {}) {
    this.tools = [...tools];
    this.handler = options.onCall ?? (({ name, args }) => ({ content: [{ type: "text", text: `called ${name} with ${JSON.stringify(args)}` }] }));
    this.listToolsBehaviour = options.onListTools;
  }

  async listTools(): Promise<RemoteToolDescriptor[]> {
    if (this.listToolsBehaviour) return this.listToolsBehaviour();
    return [...this.tools];
  }

  async callTool(request: McpToolCallRequiredArgs, options: McpToolCallOptions = {}): Promise<RemoteToolResult> {
    this.calls.push({ name: request.name, arguments: request.arguments });
    // The injected remote must see cancellation too, so wiring tests can exercise the real ABI.
    return this.handler({ name: request.name, args: request.arguments }, options);
  }

  async close(_required: Record<string, never>): Promise<void> {
    this.closed = true;
  }
}

/** One JSON-RPC message the fake channel received from the client under test. */
export interface CapturedRpcMessage {
  jsonrpc?: string | undefined;
  id?: number | undefined;
  method?: string | undefined;
  params?: Record<string, unknown> | undefined;
  error?: { code?: number | undefined; message?: string | undefined } | undefined;
}

/**
 * A fake {@link McpStdioChannel} that plays the SERVER side of MCP, under the test's control.
 *
 * `respond` is a plain function of the received message, so a test scripts a server by writing one:
 * return a response object to reply, or `undefined` to stay silent (the case that exercises the
 * client's timeout path). Everything the client sends is captured in {@link sent}, which is how
 * handshake ordering is asserted — that `initialize` comes first and that
 * `notifications/initialized` follows it with no `id`.
 */
export class ScriptedMcpStdioChannel implements McpStdioChannel {
  /** Every message the client wrote, parsed, in order. */
  readonly sent: CapturedRpcMessage[] = [];
  closedReason: string | null = null;

  private readonly messageListeners: Array<(required: { message: string }) => void> = [];
  private readonly closeListeners: Array<(required: { reason: string }) => void> = [];
  private readonly respond: (required: { message: CapturedRpcMessage }) => unknown;
  private readonly messages: FederationMessages;

  constructor(options: {
    /** Return a JSON-RPC response object to reply with, or `undefined` for silence. */
    respond: (required: { message: CapturedRpcMessage }) => unknown;
    messages: FederationMessages;
  }) {
    this.respond = options.respond;
    this.messages = options.messages;
  }

  send({ message }: { message: string }): void {
    if (this.closedReason !== null) throw new Error("scripted channel is closed");
    const parsed = JSON.parse(message) as CapturedRpcMessage;
    this.sent.push(parsed);
    const reply = this.respond({ message: parsed });
    // Delivered on a later microtask, as a real pipe would: a client that only works when its reply
    // arrives synchronously inside its own `send` is a client that does not work.
    if (reply !== undefined) queueMicrotask(() => this.deliver({ message: reply }));
  }

  onMessage({ listener }: { listener: (required: { message: string }) => void }): void {
    this.messageListeners.push(listener);
  }

  onClose({ listener }: { listener: (required: { reason: string }) => void }): void {
    this.closeListeners.push(listener);
  }

  close(_required: Record<string, never>): void {
    this.fail({ reason: this.messages.closedByHost });
  }

  /** Pushes a message to the client out of band — for late replies, unsolicited server requests,
   * and notifications. */
  deliver({ message }: { message: unknown }): void {
    const line = typeof message === "string" ? message : JSON.stringify(message);
    for (const listener of this.messageListeners) listener({ message: line });
  }

  /** Simulates the far end dying. */
  fail({ reason }: { reason: string }): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    for (const listener of this.closeListeners) listener({ reason: reason });
  }

  /** The last id the client used for `method`, for building a matching reply. */
  idFor({ method }: { method: string }): number | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i]?.method === method) return this.sent[i]?.id;
    }
    return undefined;
  }
}

/** One request the fake exchange received from the client under test. */
export interface CapturedHttpRequest {
  readonly url: string;
  readonly method: "POST" | "DELETE";
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON-RPC frame, or `undefined` for a bodyless request. */
  readonly message: CapturedRpcMessage | undefined;
}

/** What a scripted server answers with. Defaults fill in the boring parts so a test states only
 *  the field it is actually exercising. */
export interface ScriptedHttpReply {
  readonly status?: number | undefined;
  readonly contentType?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly wwwAuthenticate?: string | undefined;
  /** A JSON-RPC object (serialized for the client), or a raw string for malformed-body cases. */
  readonly body?: unknown | undefined;
}

/**
 * A fake {@link McpHttpExchange} that plays the SERVER side of MCP's Streamable HTTP transport.
 *
 * The hosted counterpart to {@link ScriptedMcpStdioChannel}, and it exists for the same reason: so
 * `adapter.http.ts`'s REAL handshake ordering, session-id propagation, SSE framing, pagination,
 * status mapping and timeout behaviour are exercised against something that can misbehave on
 * purpose — answer 401, answer with an unparseable body, issue a header-injecting session id,
 * paginate forever, or never answer at all — rather than against a stub of the client itself.
 *
 * `respond` is a plain function of the received request, so a test scripts a server by writing one.
 * Returning `undefined` means "never answer", which is how the timeout path is reached: the
 * returned promise stays pending until the client's own `AbortSignal` fires.
 */
export class ScriptedMcpHttpExchange implements McpHttpExchange {
  /** Every request the client made, in order. */
  readonly sent: CapturedHttpRequest[] = [];

  private readonly respond: (required: { request: CapturedHttpRequest }) => ScriptedHttpReply | undefined;

  constructor(options: { respond: (required: { request: CapturedHttpRequest }) => ScriptedHttpReply | undefined }) {
    this.respond = options.respond;
  }

  async send(request: McpHttpRequestRequiredArgs, options: McpHttpRequestOptions = {}): Promise<McpHttpResponse> {
    const captured: CapturedHttpRequest = {
      url: request.url,
      method: request.method,
      headers: { ...request.headers },
      message: options.body === undefined ? undefined : (JSON.parse(options.body) as CapturedRpcMessage),
    };
    this.sent.push(captured);

    const reply = this.respond({ request: captured });
    if (reply === undefined) return this.neverAnswer(options.signal);

    return {
      status: reply.status ?? 200,
      contentType: reply.contentType ?? "application/json",
      ...(reply.sessionId === undefined ? {} : { sessionId: reply.sessionId }),
      ...(reply.wwwAuthenticate === undefined ? {} : { wwwAuthenticate: reply.wwwAuthenticate }),
      text: typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}),
    };
  }

  /** A server that accepts the request and then goes quiet. Settles only when the client aborts,
   *  which is exactly what a real stalled connection does. */
  private neverAnswer(signal: AbortSignal | undefined): Promise<McpHttpResponse> {
    return new Promise<McpHttpResponse>((_resolve, reject) => {
      if (!signal) return;
      if (signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }

  /** The last request whose JSON-RPC `method` matches, for asserting on what was sent. */
  lastRequestFor({ method }: { method: string }): CapturedHttpRequest | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const candidate = this.sent[i];
      if (candidate?.message?.method === method) return candidate;
    }
    return undefined;
  }
}

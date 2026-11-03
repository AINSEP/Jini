/** SDK Streamable HTTP adapter for the existing tool host. Capabilities remain in host memory. */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { adaptSdkTransport } from './sdk-transport.js';
import { createMcpToolServer, type McpToolServerRequiredArgs, type McpToolServerOptions } from './tool-server.js';

export interface McpHttpToolServerOptions extends Pick<McpToolServerOptions, 'resources' | 'instructions' | 'fetchImpl' | 'authHeaders' | 'delegatedTools' | 'resultPaging' | 'diagnosticToolIds' | 'messageRelay'> {
  /** One SDK session per run listener; desktop remains stateless by default. */
  readonly sessionMode?: boolean;
  /** Value-free diagnostics. Never receives headers, bodies, tool arguments or credentials. */
  readonly warn?: (message: string) => void;
  /** Native listener seam for embeddings and wire-level lifecycle tests. */
  readonly createHttpServer?: (listener: (request: IncomingMessage, response: ServerResponse) => void) => HttpServer;
}
export interface McpHttpToolServerHandle {
  readonly url: string;
  readonly token: string;
  /** Stop admission and drain accepted work; no idle timer interrupts handlers. */
  close(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}
/** Embeddings must gate CLI HTTP on retained-session support rather than a protocol probe. */
export const MCP_HTTP_SESSION_MODE_SUPPORTED = true;
const MAX_BODY_BYTES = 1_000_000;
const MAX_REQUESTS = 16;

/** Constant-time credential comparison after a length check. O(credential bytes). */
function authorized({ request, token }: { request: IncomingMessage; token: string }, _options = {}): boolean {
  const actual = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Read at most one bounded JSON document. The receive deadline ends before tool execution.
 * Returns HTTP status on invalid/oversized input, without interpreting MCP messages. O(body bytes).
 */
async function readBody({ request }: { request: IncomingMessage }, _options = {}): Promise<{ body: unknown } | { status: number }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) return { status: 413 };
    chunks.push(buffer);
  }
  try { return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
  catch { return { status: 400 }; }
}

/** Bind a private loopback listener. Desktop requests use fresh stateless SDK transports;
 * run listeners opt into one retained SDK session and the same host-owned dispatch contract. Auth precedes body parsing; browsers are always refused.
 * @example const host = await startMcpHttpToolServer({ name, version, tools, resolveBaseUrl });
 * @throws Listen/configuration errors; the embedding owns degraded startup and retries.
 * @complexity O(body bytes + dispatched handler), with 16 requests and 1 MB per body maximum.
 */
export async function startMcpHttpToolServer(required: McpToolServerRequiredArgs, options: McpHttpToolServerOptions = {}): Promise<McpHttpToolServerHandle> {
  const host = createMcpToolServer(required, options);
  const token = randomBytes(32).toString('hex');
  const pending = new Set<Promise<void>>();
  const sessionTransport = options.sessionMode
    ? new StreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: randomUUID }) : undefined;
  let sessionConnection: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const server = (options.createHttpServer ?? createServer)((request, response) => {
    const work = handle(request, response).catch(() => {
      options.warn?.('MCP HTTP request failed');
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 15_000;
  server.maxConnections = MAX_REQUESTS;

  /** Gate admission before acquiring bytes or SDK state. O(1) plus a bounded body and tool work. */
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.origin !== undefined || !authorized({ request, token })) {
      response.writeHead(403, { Connection: 'close' }).end(); return;
    }
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    const allowed = options.sessionMode ? ['POST', 'GET', 'DELETE'] : ['POST'];
    if (!allowed.includes(request.method ?? '')) { response.writeHead(405, { Allow: allowed.join(', ') }).end(); return; }
    if (stopped || pending.size >= MAX_REQUESTS) { response.writeHead(503).end(); return; }
    await dispatch(request, response);
  }

  /** Dispose the SDK connection after response delivery, including failed/abandoned requests.
   * The SDK owns initialize, notifications, validation, list and call; no handwritten dispatch.
   */
  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown;
    if (request.method === 'POST') {
      // Bound slow authenticated senders too. This timer never limits tool execution.
      const deadline = setTimeout(() => request.destroy(), 15_000);
      deadline.unref();
      let input: Awaited<ReturnType<typeof readBody>>;
      try { input = await readBody({ request }); }
      finally { clearTimeout(deadline); }
      if ('status' in input) { response.writeHead(input.status, { Connection: 'close' }).end(); return; }
      body = input.body;
    }
    if (sessionTransport) {
      sessionConnection ??= host.run({ transport: adaptSdkTransport({ transport: sessionTransport }) });
      await sessionConnection;
      if (request.method === 'GET' && stopped) { response.writeHead(503).end(); return; }
      await sessionTransport.handleRequest(request, response, body);
      return;
    }
    // No sessionIdGenerator means stateless mode in the pinned SDK.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await host.run({ transport: adaptSdkTransport({ transport }) });
      await transport.handleRequest(request, response, body);
    } finally { await transport.close(); }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('MCP HTTP listener has no TCP address');
  const port = address.port;

  /** Repair only the listener, retaining the exact URL/token and never replaying tool work. O(1). */
  function repairListener(): void {
    if (stopped || server.listening || retry) return;
    options.warn?.('MCP HTTP listener unavailable; retrying automatically');
    retry = setTimeout(() => {
      retry = undefined;
      if (!stopped && !server.listening) server.listen(port, '127.0.0.1');
    }, 1000);
    retry.unref();
  }
  server.on('error', repairListener);
  server.on('close', repairListener);
  return {
    url: `http://127.0.0.1:${port}/mcp`, token,
    close(_required, _optional = {}) {
      stopped = true;
      clearTimeout(retry);
      closing ??= (async () => {
        // End passive SSE first; otherwise server.close() would wait for the client forever.
        // JSON-response POSTs retain the accepted work until their handlers finish.
        sessionTransport?.closeStandaloneSSEStream();
        const listenerClosed = new Promise<void>((resolve, reject) => {
          server.close(error => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        });
        await Promise.all(pending);
        await sessionConnection?.catch(() => {});
        await sessionTransport?.close();
        server.closeIdleConnections();
        await listenerClosed;
      })();
      return closing;
    },
  };
}

export interface McpHttpToolServerRuntime {
  /** Best-effort startup: absent until a listener binds; failures repair in the background. */
  capability(required: Record<string, never>, optional?: Record<string, never>): Promise<Pick<McpHttpToolServerHandle, 'url' | 'token'> | undefined>;
  /** Deliver a capability after binding, including initial recovery. Failed handoffs retry;
   * unsubscribe cancels pending deliveries. This must never be used to replay tool calls. */
  subscribe(required: { listener: (capability: Pick<McpHttpToolServerHandle, 'url' | 'token'>) => void | Promise<void> }, optional?: Record<string, never>): () => void;
  close(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Own one shared HTTP listener independently of site/window lifecycles. No I/O until capability()
 * is called. Concurrent callers share a start; shutdown cancels retries and drains a pending bind.
 * @example const runtime = createMcpHttpToolServerRuntime({ name, version, tools, resolveBaseUrl });
 * @complexity O(1) state beyond the bounded HTTP listener and caller-supplied tool table.
 */
export function createMcpHttpToolServerRuntime(required: McpToolServerRequiredArgs,
  { start = startMcpHttpToolServer, ...options }: McpHttpToolServerOptions & { start?: typeof startMcpHttpToolServer } = {},
): McpHttpToolServerRuntime {
  let host: McpHttpToolServerHandle | undefined;
  let starting: Promise<McpHttpToolServerHandle | undefined> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let closing: Promise<void> | undefined;
  const listeners = new Set<(capability: Pick<McpHttpToolServerHandle, 'url' | 'token'>) => void>();
  const subscriptions = new Set<() => void>();

  /** Single-flight bind; errors expose no capability or native error text. O(1) beyond bind. */
  function ensureListener(): Promise<McpHttpToolServerHandle | undefined> {
    if (stopped) return Promise.resolve(undefined);
    if (host) return Promise.resolve(host);
    if (starting) return starting;
    starting = start(required, options).then(async handle => {
      if (stopped) { await handle.close({}); return undefined; }
      host = handle;
      for (const listener of listeners) listener({ url: handle.url, token: handle.token });
      return handle;
    }).catch(() => {
      if (!stopped) {
        options.warn?.('MCP HTTP listener unavailable; retrying automatically');
        retry ??= setTimeout(() => { retry = undefined; void ensureListener(); }, 1000);
        retry.unref();
      }
      return undefined;
    }).finally(() => { starting = undefined; });
    return starting;
  }

  return {
    subscribe({ listener }, _optional = {}) {
      if (stopped) return () => {};
      let cancelled = false;
      let deliveryRetry: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = () => {
        cancelled = true;
        clearTimeout(deliveryRetry);
        listeners.delete(deliver);
        subscriptions.delete(unsubscribe);
      };
      /** Retry only capability delivery. A subscriber's error never changes the bound host. O(1). */
      function deliver(capability: Pick<McpHttpToolServerHandle, 'url' | 'token'>): void {
        void Promise.resolve().then(() => { if (!cancelled) return listener(capability); }).catch(() => {
          if (cancelled) return;
          options.warn?.('MCP HTTP capability delivery unavailable; retrying automatically');
          deliveryRetry = setTimeout(() => deliver(capability), 1000);
          deliveryRetry.unref();
        });
      }
      listeners.add(deliver);
      subscriptions.add(unsubscribe);
      if (host) deliver({ url: host.url, token: host.token });
      void ensureListener();
      return unsubscribe;
    },
    async capability(_required, _optional = {}) {
      const handle = await ensureListener();
      return handle ? { url: handle.url, token: handle.token } : undefined;
    },
    close(_required, _optional = {}) {
      stopped = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      listeners.clear();
      clearTimeout(retry);
      closing ??= (async () => { await starting; await host?.close({}); host = undefined; })();
      return closing;
    },
  };
}

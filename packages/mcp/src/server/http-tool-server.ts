/** SDK Streamable HTTP adapter for the existing tool host. Capabilities remain in host memory. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { adaptSdkTransport } from './sdk-transport.js';
import { createMcpToolServer, type McpToolServerRequiredArgs, type McpToolServerOptions } from './tool-server.js';

export interface McpHttpToolServerOptions extends Pick<McpToolServerOptions, 'resources' | 'instructions' | 'fetchImpl' | 'authHeaders'> {
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

/** Bind a private loopback listener. Each HTTP request gets a fresh stateless SDK transport and
 * the same host-owned dispatch contract. Auth precedes body parsing; browsers are always refused.
 * @example const host = await startMcpHttpToolServer({ name, version, tools, resolveBaseUrl });
 * @throws Listen/configuration errors; the embedding owns degraded startup and retries.
 * @complexity O(body bytes + dispatched handler), with 16 requests and 1 MB per body maximum.
 */
export async function startMcpHttpToolServer(required: McpToolServerRequiredArgs, options: McpHttpToolServerOptions = {}): Promise<McpHttpToolServerHandle> {
  const host = createMcpToolServer(required, options);
  const token = randomBytes(32).toString('hex');
  const pending = new Set<Promise<void>>();
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
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    if (stopped || pending.size >= MAX_REQUESTS) { response.writeHead(503).end(); return; }
    await dispatch(request, response);
  }

  /** Dispose the SDK connection after response delivery, including failed/abandoned requests.
   * The SDK owns initialize, notifications, validation, list and call; no handwritten dispatch.
   */
  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Bound slow authenticated senders too. This timer never limits tool execution.
    const deadline = setTimeout(() => request.destroy(), 15_000);
    deadline.unref();
    let input: Awaited<ReturnType<typeof readBody>>;
    try { input = await readBody({ request }); }
    finally { clearTimeout(deadline); }
    if ('status' in input) { response.writeHead(input.status, { Connection: 'close' }).end(); return; }
    // No sessionIdGenerator means stateless mode in the pinned SDK.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await host.run({ transport: adaptSdkTransport({ transport }) });
      await transport.handleRequest(request, response, input.body);
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
      closing ??= new Promise<void>((resolve, reject) => {
        server.close(error => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      }).then(async () => { await Promise.all(pending); });
      return closing;
    },
  };
}

export interface McpHttpToolServerRuntime {
  /** Best-effort startup: absent until a listener binds; failures repair in the background. */
  capability(required: Record<string, never>, optional?: Record<string, never>): Promise<Pick<McpHttpToolServerHandle, 'url' | 'token'> | undefined>;
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

  /** Single-flight bind; errors expose no capability or native error text. O(1) beyond bind. */
  function ensureListener(): Promise<McpHttpToolServerHandle | undefined> {
    if (stopped) return Promise.resolve(undefined);
    if (host) return Promise.resolve(host);
    if (starting) return starting;
    starting = start(required, options).then(async handle => {
      if (stopped) { await handle.close({}); return undefined; }
      host = handle;
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
    async capability(_required, _optional = {}) {
      const handle = await ensureListener();
      return handle ? { url: handle.url, token: handle.token } : undefined;
    },
    close(_required, _optional = {}) {
      stopped = true;
      clearTimeout(retry);
      closing ??= (async () => { await starting; await host?.close({}); host = undefined; })();
      return closing;
    },
  };
}

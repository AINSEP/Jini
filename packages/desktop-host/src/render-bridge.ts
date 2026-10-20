/** Private native-render transport. The capability travels in the launcher environment, never
 * a renderer/preload bridge or a boot-token log. Descendant daemons can use the same endpoint.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { RenderServiceError, type RenderServiceErrorCode } from './render-service.js';
import { readUrlCaptureRequest, URL_CAPTURE_MAX_BYTES, URL_CAPTURE_TIMEOUT_MS, type UrlCapturePort, type UrlCaptureResult } from './url-capture.js';

export const RENDER_BRIDGE_URL_ENV = 'JINI_DESKTOP_RENDER_URL';
export const RENDER_BRIDGE_TOKEN_ENV = 'JINI_DESKTOP_RENDER_TOKEN';
const MAX_WIRE_BYTES = Math.ceil(URL_CAPTURE_MAX_BYTES / 3) * 4 + 8192;

/** Bounded body reader shared by server requests and client responses; never buffers past cap.
 * @throws RenderServiceError when the peer exceeds the byte limit. @complexity O(bytes).
 */
async function readBody({ stream, limit }: { stream: AsyncIterable<Uint8Array>; limit: number }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) throw new RenderServiceError({ code: 'load-failed', message: 'capture transport size limit exceeded' });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Constant-time capability comparison, including a length check before the native primitive. */
function authorized({ authorization, token }: { authorization: string | undefined; token: string }): boolean {
  const actual = Buffer.from(authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Start one per launched server. No public bind, browser credentials, redirects or cookies.
 * @example const bridge = await startRenderBridge({ capture }); // pass bridge.env to the child
 * @complexity O(bytes) per capture; one active render, at most 16 MiB of PNG output.
 */
export async function startRenderBridge({ capture }: { capture: UrlCapturePort },
  { createServer: makeServer = createServer }: { createServer?: typeof createServer } = {},
): Promise<{ env: Record<string, string>; close(): void }> {
  const token = randomBytes(32).toString('hex');
  let active: AbortController | undefined;
  let closed = false;
  const server = makeServer((req, res) => { void handle(req, res).catch(() => res.destroy()); });
  server.requestTimeout = URL_CAPTURE_TIMEOUT_MS;
  server.headersTimeout = 5000;
  server.maxConnections = 4;

  /** Auth and bounds precede rendering; disconnect cancels work and never leaks a native error. */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST' || req.url !== '/capture' || req.headers.origin || !authorized({ authorization: req.headers.authorization, token })) {
      res.writeHead(403).end(); return;
    }
    if (closed || active) { res.writeHead(429).end(); return; }
    const controller = new AbortController();
    active = controller;
    const abort = () => controller.abort();
    res.once('close', abort);
    const timer = setTimeout(() => {
      controller.abort();
      // A peer that authenticated and then stopped sending its JSON must release the slot too.
      req.destroy();
    }, URL_CAPTURE_TIMEOUT_MS);
    try {
      const request = readUrlCaptureRequest({ value: JSON.parse((await readBody({ stream: req, limit: 8192 })).toString('utf8')) });
      const result = await capture.captureUrl(request, { signal: controller.signal });
      if (result.png.byteLength > URL_CAPTURE_MAX_BYTES) throw new RenderServiceError({ code: 'load-failed', message: 'capture too large' });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...result, png: Buffer.from(result.png).toString('base64') }));
    } catch (error) {
      const code = error instanceof RenderServiceError ? error.code : 'load-failed';
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: code }));
    } finally {
      clearTimeout(timer);
      res.removeListener('close', abort);
      active = undefined;
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address() as { port: number };
  return { env: { [RENDER_BRIDGE_URL_ENV]: `http://127.0.0.1:${address.port}/capture`, [RENDER_BRIDGE_TOKEN_ENV]: token },
    close() { closed = true; active?.abort(); server.close(); server.closeAllConnections(); } };
}

function isPrivateCaptureEndpoint({ url }: { url: URL }, _options = {}): boolean {
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/capture'
    && !url.username && !url.password && !url.search && !url.hash;
}

async function readCaptureResponse({ response }: { response: Response }, _options = {}): Promise<UrlCaptureResult> {
  if (!response.body) throw new RenderServiceError({ code: 'load-failed', message: 'empty desktop capture response' });
  const data = JSON.parse((await readBody({ stream: response.body as unknown as AsyncIterable<Uint8Array>, limit: MAX_WIRE_BYTES })).toString('utf8'));
  if (!response.ok) {
    const known: RenderServiceErrorCode[] = ['timeout', 'aborted', 'load-failed', 'navigation-blocked', 'not-implemented'];
    const code = known.includes(data.error) ? data.error : 'load-failed';
    throw new RenderServiceError({ code, message: 'desktop capture failed' });
  }
  if (typeof data.png !== 'string' || data.png.length > MAX_WIRE_BYTES) throw new RenderServiceError({ code: 'load-failed', message: 'invalid desktop capture response' });
  const png = Buffer.from(data.png, 'base64');
  if (png.byteLength > URL_CAPTURE_MAX_BYTES) throw new RenderServiceError({ code: 'load-failed', message: 'capture too large' });
  return { ...data, png };
}

/** Detect a complete private bridge contract; a partial/invalid contract fails closed.
 * No bridge returns null so hosts retain their current browser fallback.
 * @example const capture = renderBridgeFromEnv({ env: process.env });
 * @complexity O(1), plus bounded request/PNG bytes per capture.
 */
export function renderBridgeFromEnv(
  { env }: { env: Record<string, string | undefined> }, { fetch: send = globalThis.fetch }: { fetch?: typeof globalThis.fetch } = {},
): UrlCapturePort | null {
  const endpoint = env[RENDER_BRIDGE_URL_ENV];
  const token = env[RENDER_BRIDGE_TOKEN_ENV];
  if (endpoint === undefined && token === undefined) return null;
  let url: URL;
  try { url = new URL(endpoint ?? ''); } catch { throw new RenderServiceError({ code: 'load-failed', message: 'invalid desktop capture channel' }); }
  if (!isPrivateCaptureEndpoint({ url }) || !/^[a-f0-9]{64}$/.test(token ?? '')) {
    throw new RenderServiceError({ code: 'load-failed', message: 'invalid desktop capture channel' });
  }
  return { async captureUrl(request, { signal } = {}): Promise<UrlCaptureResult> {
    const timeout = AbortSignal.timeout(URL_CAPTURE_TIMEOUT_MS);
    try {
      const response = await send(url.href, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(readUrlCaptureRequest({ value: request })),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return await readCaptureResponse({ response });
    } catch (error) {
      if (error instanceof RenderServiceError) throw error;
      const code = timeout.aborted ? 'timeout' : signal?.aborted ? 'aborted' : 'load-failed';
      throw new RenderServiceError({ code, message: 'desktop capture channel unavailable' });
    }
  } };
}

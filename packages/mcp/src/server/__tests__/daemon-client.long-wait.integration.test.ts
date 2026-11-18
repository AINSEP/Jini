import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { postDaemonJson } from '../daemon-client.js';

/**
 * Characterization (S15 step 0b): does the HTTP hop to the daemon have its own header wait?
 *
 * Node's global `fetch` is undici, whose default `headersTimeout` is 300 000 ms (measured on the
 * Node in use; see cloud-results/wave1-tc-S15.md). A 300 s test is not practical, so this suite
 * builds the same kind of wall with a 200 ms dispatcher and a real local HTTP server (no fake
 * fetch) and pins what the caller sees today when the daemon answers after the wall.
 */

/** The two undici members this test uses; `mcp` declares no `undici`, so its types are not imported. */
interface UndiciSubset {
  Agent: new (options: { headersTimeout: number }) => object;
  fetch: (url: string, init: Omit<RequestInit, 'dispatcher'> & { dispatcher: object }) => Promise<Response>;
}

/** `undici` is a dependency of `@jini-ai/platform`, not of `mcp`; resolve it from there, as the platform adapter does. */
function loadUndici(): UndiciSubset {
  const fromMcp = createRequire(import.meta.url);
  return createRequire(fromMcp.resolve('@jini-ai/platform'))('undici') as UndiciSubset;
}

let server: Server | undefined;

afterEach(async () => {
  if (server === undefined) return;
  server.closeAllConnections();
  await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

/** A real loopback daemon stand-in that sends its response headers only after `delayMs`. */
async function startDaemonAnsweringAfter({ delayMs }: { delayMs: number }): Promise<{ baseUrl: string }> {
  server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    }, delayMs).unref();
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
  return { baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}` };
}

function fetchWithHeaderWait({ headersTimeoutMs }: { headersTimeoutMs: number }): typeof fetch {
  // The global `fetch` ignores a userland dispatcher, so the same undici version's own `fetch` carries the wall.
  const { Agent, fetch: undiciFetch } = loadUndici();
  const dispatcher = new Agent({ headersTimeout: headersTimeoutMs });
  return ((url: string, init: RequestInit) => undiciFetch(url, { ...init, dispatcher })) as typeof fetch;
}

describe('postDaemonJson through a fetch with a header wait (real local server)', () => {
  it('control: a daemon that answers inside the header wait succeeds', async () => {
    const { baseUrl } = await startDaemonAnsweringAfter({ delayMs: 50 });
    const body = await postDaemonJson({ baseUrl, route: '/slow', body: {} }, { timeoutMs: null, fetchImpl: fetchWithHeaderWait({ headersTimeoutMs: 2_000 }) });
    expect(body).toEqual({ ok: true });
  });

  it('a daemon that answers after the header wait fails with the bare words fetch failed, although the caller set no deadline', async () => {
    const { baseUrl } = await startDaemonAnsweringAfter({ delayMs: 1_500 });
    const call = postDaemonJson({ baseUrl, route: '/slow', body: {} }, { timeoutMs: null, fetchImpl: fetchWithHeaderWait({ headersTimeoutMs: 200 }) });
    await expect(call).rejects.toEqual(new Error('fetch failed'));
  });
});

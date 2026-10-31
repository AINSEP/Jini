import { createServer, get, type ServerOptions } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeLoopbackHttp } from '../index.js';
import { LEAF_CERT, LEAF_KEY, OTHER_CERT, OTHER_KEY, ROOT_CERT, SELF_CERT, SELF_KEY, WRONGHOST_CERT, WRONGHOST_KEY } from './fixtures/local-probe-tls.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function serve(credentials: ServerOptions, status = 200, headers = {}) {
  const paths: string[] = [];
  const server = createServer(credentials, (request, response) => {
    paths.push(request.url!);
    response.writeHead(status, headers).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, paths };
}

describe('loopback HTTP readiness over real TLS', () => {
  it('accepts the configured non-CA leaf with a mkcert-style issuer chain', async () => {
    const server = await serve({ cert: LEAF_CERT + '\n' + ROOT_CERT, key: LEAF_KEY });
    const options = { certificate: LEAF_CERT, servername: 'localhost' };
    // Mutation: removing allowPartialTrustChain rejects this leaf as an incomplete trust chain.
    expect(await probeLoopbackHttp({ url: server.url + '/readyz' }, options)).toBe(true);
    expect(await probeLoopbackHttp({ url: server.url + '/admin/' }, options)).toBe(true);
    expect(server.paths).toEqual(['/readyz', '/admin/']);
  });

  it('accepts a configured self-signed non-CA leaf', async () => {
    const server = await serve({ cert: SELF_CERT, key: SELF_KEY });
    expect(await probeLoopbackHttp({ url: server.url }, { certificate: SELF_CERT, servername: 'localhost' })).toBe(true);
  });

  it.each(['localhost', 'localhost.'])('connects %s only over loopback and verifies localhost', async hostname => {
    const server = await serve({ cert: LEAF_CERT, key: LEAF_KEY });
    const port = new URL(server.url).port;
    expect(await probeLoopbackHttp({ url: `https://${hostname}:${port}/readyz` }, { certificate: LEAF_CERT })).toBe(true);
    expect(server.paths).toEqual(['/readyz']);
  });

  it('rejects another leaf from the same issuer even when the configured PEM includes the issuer', async () => {
    const server = await serve({ cert: OTHER_CERT + '\n' + ROOT_CERT, key: OTHER_KEY });
    // Trusting the whole bundle would accidentally authorize this different server.
    expect(await probeLoopbackHttp({ url: server.url }, { certificate: LEAF_CERT + '\n' + ROOT_CERT, servername: 'localhost' })).toBe(false);
    expect(server.paths).toEqual([]);
  });

  it('rejects an unrelated self-signed server', async () => {
    const server = await serve({ cert: SELF_CERT, key: SELF_KEY });
    expect(await probeLoopbackHttp({ url: server.url }, { certificate: LEAF_CERT, servername: 'localhost' })).toBe(false);
    expect(server.paths).toEqual([]);
  });

  it('rejects a configured leaf whose hostname mismatches localhost', async () => {
    const server = await serve({ cert: WRONGHOST_CERT, key: WRONGHOST_KEY });
    expect(await probeLoopbackHttp({ url: server.url }, { certificate: WRONGHOST_CERT, servername: 'localhost' })).toBe(false);
    expect(server.paths).toEqual([]);
  });

  it('keeps default verification without a configured certificate', async () => {
    const server = await serve({ cert: SELF_CERT, key: SELF_KEY });
    expect(await probeLoopbackHttp({ url: server.url })).toBe(false);
    expect(server.paths).toEqual([]);
  });

  it.each(['example.com', '192.168.1.10', 'localhost.evil.example', '0.0.0.0'])('refuses certificate trust for non-loopback %s', async hostname => {
    expect(await probeLoopbackHttp({ url: `https://${hostname}/readyz` }, { certificate: LEAF_CERT })).toBe(false);
  });

  it('does not change verification for other HTTPS clients', async () => {
    const server = await serve({ cert: SELF_CERT, key: SELF_KEY });
    expect(await probeLoopbackHttp({ url: server.url }, { certificate: SELF_CERT, servername: 'localhost' })).toBe(true);
    const error = await new Promise<Error>((resolve, reject) => {
      get(server.url, { agent: false, rejectUnauthorized: true }, response => { response.resume(); reject(new Error('untrusted TLS was accepted')); }).on('error', resolve);
    });
    expect((error as NodeJS.ErrnoException).code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(server.paths).toEqual(['/']);
  });

  it.each([302, 503])('requires HTTP 200 and never follows a %s response', async status => {
    const server = await serve({ cert: LEAF_CERT, key: LEAF_KEY }, status, { location: 'https://example.com/' });
    expect(await probeLoopbackHttp({ url: server.url }, { certificate: LEAF_CERT, servername: 'localhost' })).toBe(false);
    expect(server.paths).toEqual(['/']);
  });

  it('preserves plain HTTP probing when dev TLS is disabled', async () => {
    const server = createHttpServer((_request, response) => response.writeHead(200).end());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
    expect(await probeLoopbackHttp({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/readyz` })).toBe(true);
  });

  it('expires a request even when the TLS server never sends response headers', async () => {
    const paths: string[] = [];
    const server = createServer({ cert: LEAF_CERT, key: LEAF_KEY }, request => { paths.push(request.url!); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
    const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/readyz`;
    expect(await probeLoopbackHttp({ url }, { certificate: LEAF_CERT, servername: 'localhost', timeoutMs: 500 })).toBe(false);
    expect(paths).toEqual(['/readyz']);
  });
});

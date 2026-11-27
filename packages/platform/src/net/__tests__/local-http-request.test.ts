import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { LEAF_CERT, LEAF_KEY, ROOT_CERT } from './fixtures/local-probe-tls.js';
import { requestLoopbackHttp } from '../local-http-request.js';

test('local dev control sends a capability header and JSON body without following redirects', async () => {
  const server = createServer((req, res) => {
    expect(req.headers['x-capability']).toBe('private');
    res.writeHead(307, { location: 'https://example.com' }); res.end('local');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await requestLoopbackHttp({ url: `http://localhost:${address.port}`, method: 'POST', headers: { 'x-capability': 'private' }, body: '{}' });
    expect(result).toEqual({ status: 307, body: Buffer.from('local'), contentType: undefined });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('local control refuses remote addresses before sending credentials', async () => {
  await expect(requestLoopbackHttp({ url: 'https://example.com', method: 'GET' })).rejects.toThrow('loopback');
});

test('local control refuses non-HTTP schemes even on loopback', async () => {
  await expect(requestLoopbackHttp({ url: 'ftp://127.0.0.1/file', method: 'GET' })).rejects.toThrow('Expected loopback HTTP URL');
});

test('local control reads a complete body at the byte cap and rejects a larger response', async () => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    response.writeHead(201, { 'content-type': 'application/octet-stream' });
    response.end(request.url === '/exact' ? Buffer.from([0, 255, 2]) : Buffer.from([0, 255, 2, 3]));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address() as { port: number };
    const url = `http://localhost:${port}`;
    await expect(requestLoopbackHttp({ url: url + '/exact', method: 'GET' }, { maxBytes: 3 })).resolves.toEqual({
      status: 201, body: Buffer.from([0, 255, 2]), contentType: 'application/octet-stream',
    });
    await expect(requestLoopbackHttp({ url: url + '/over', method: 'GET' }, { maxBytes: 3 })).rejects.toThrow('Local response too large');
    expect(paths).toEqual(['/exact', '/over']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});

test('local control requires TLS trust before delivering headers and body to the pinned local service', async () => {
  const received: Array<{ method?: string | undefined; path?: string | undefined; capability: string | string[] | undefined; body: string }> = [];
  const server = createTlsServer({ cert: LEAF_CERT + '\n' + ROOT_CERT, key: LEAF_KEY }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.once('end', () => {
      received.push({ method: request.method, path: request.url, capability: request.headers['x-capability'], body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(202, { 'content-type': 'text/plain' }).end('queued');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address() as { port: number };
    const input = { url: `https://localhost:${port}/queue`, method: 'POST', headers: { 'x-capability': 'fixture-only' }, body: '{"value":7}' };
    await expect(requestLoopbackHttp(input)).rejects.toMatchObject({ code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(received).toEqual([]);
    await expect(requestLoopbackHttp(input, { certificate: LEAF_CERT })).resolves.toEqual({
      status: 202, body: Buffer.from('queued'), contentType: 'text/plain',
    });
    expect(received).toEqual([{ method: 'POST', path: '/queue', capability: 'fixture-only', body: '{"value":7}' }]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});

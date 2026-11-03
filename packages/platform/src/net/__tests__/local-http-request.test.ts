import { expect, test } from 'vitest';
import { createServer } from 'node:http';
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

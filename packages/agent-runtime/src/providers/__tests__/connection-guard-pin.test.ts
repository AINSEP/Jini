import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { pinnedFetch, validateBaseUrlResolved } from '../connection-guard.js';

// G11 pins for the guarded transport: the connection is bound to the address the guard approved,
// private/link-local resolutions are refused before any dial, and redirects never reach a second host.
// `.invalid` (RFC 2606) can never resolve, so these stay hermetic: reaching the local server proves
// the transport used the pinned address and never asked the system resolver.
async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
  return address.port;
}
const close = (server: http.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe('guarded transport: validated address -> pinned connection', () => {
  it('connects through the address validateBaseUrlResolved approved, with the original Host header', async () => {
    const server = http.createServer((req, res) => res.end(JSON.stringify({ host: req.headers.host })));
    const port = await listen(server);
    try {
      const baseUrl = `http://provider.invalid:${port}`;
      const validated = await validateBaseUrlResolved({
        baseUrl,
        lookup: async () => [{ address: '127.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 }],
      });
      expect(validated.pinnedAddress).toEqual({ address: '127.0.0.1', family: 4 });
      const response = await pinnedFetch({
        url: `${baseUrl}/v1`,
        init: { method: 'POST', headers: {}, body: '{}' },
        pinnedAddress: validated.pinnedAddress,
      });
      expect(JSON.parse(await response.text())).toEqual({ host: `provider.invalid:${port}` });
    } finally {
      await close(server);
    }
  });

  it('dials the pinned address even when the hostname cannot resolve at all', async () => {
    const server = http.createServer((_req, res) => res.end('pinned'));
    const port = await listen(server);
    try {
      const response = await pinnedFetch({
        url: `http://never-resolves.invalid:${port}/`,
        init: { method: 'POST', headers: {}, body: '{}' },
        pinnedAddress: { address: '127.0.0.1', family: 4 },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('pinned');
    } finally {
      await close(server);
    }
  });

  it('without a pin the transport resolves the hostname itself (and so fails for an unresolvable name)', async () => {
    await expect(pinnedFetch({
      url: 'http://never-resolves.invalid:9/',
      init: { method: 'POST', headers: {}, body: '{}' },
      pinnedAddress: undefined,
    })).rejects.toThrow(/ENOTFOUND|EAI_AGAIN/);
  });

  it.each([
    ['RFC1918', '10.0.0.5'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['link-local metadata', '169.254.169.254'],
    ['CGNAT', '100.64.0.1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique-local', 'fd00::1'],
    ['unspecified', '0.0.0.0'],
  ])('refuses a hostname that resolves to a %s address and hands out no pin', async (_label, address) => {
    const result = await validateBaseUrlResolved({
      baseUrl: 'https://provider.invalid',
      lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
    });
    expect(result).toEqual({ error: 'Internal IPs blocked', forbidden: true });
  });

  it('refuses when any one of several resolved addresses is blocked', async () => {
    const result = await validateBaseUrlResolved({
      baseUrl: 'https://provider.invalid',
      lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }],
    });
    expect(result.forbidden).toBe(true);
    expect(result.pinnedAddress).toBeUndefined();
  });

  it('never follows a redirect to a disallowed host: the second host receives no request', async () => {
    let metadataHits = 0;
    const metadata = http.createServer((_req, res) => { metadataHits += 1; res.end('secret'); });
    const metadataPort = await listen(metadata);
    const redirector = http.createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${metadataPort}/latest/meta-data/`);
      res.end();
    });
    const port = await listen(redirector);
    try {
      await expect(pinnedFetch({
        url: `http://provider.invalid:${port}/v1`,
        init: { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' },
        pinnedAddress: { address: '127.0.0.1', family: 4 },
      })).rejects.toThrow(`refused to follow a 302 redirect to "http://127.0.0.1:${metadataPort}/latest/meta-data/"`);
      expect(metadataHits).toBe(0);
    } finally {
      await close(redirector);
      await close(metadata);
    }
  });
});

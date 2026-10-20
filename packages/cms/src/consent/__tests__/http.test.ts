import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createConsentFileRecords } from '../node/index.js';
import { once } from 'node:events';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { registerConsentHttp, type ConsentHttpPorts } from '../express/index.js';
import type { ConsentRecord } from '../types.js';
import { accepted, config, now } from './fixtures.js';
import { googleConsentSignals } from '../policy.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

async function site({ saveFails = false, readFails = false, enabled = true, allowed = true, delivery = 'live', register = {}, bodyless = false }: { delivery?: 'live' | 'static'; saveFails?: boolean; readFails?: boolean; enabled?: boolean; allowed?: boolean; register?: Parameters<typeof registerConsentHttp>[1]; bodyless?: boolean } = {}) {
  const records = new Map<string, ConsentRecord>();
  const failures: Array<{ operation: string; error: unknown }> = [];
  const ports: ConsentHttpPorts = {
    config: { get: async () => ({ ...config, enabled }) },
    records: { read: async ({ id }) => records.get(id) ?? null, save: async ({ record }) => { if (saveFails) throw new Error('Disk full'); records.set(record.id, record); } },
    clock: { nowIso: () => now, nowMs: () => Date.parse(now) }, ids: { newId: () => accepted.id },
    readReceiptId: ({ cookieHeader }) => cookieHeader.match(/jini_consent=([a-zA-Z0-9_-]+)/)?.[1] ?? null,
    origin: () => 'https://site.example', region: ({ request }) => request.get('x-edge-region') ?? null,
    allowWrite: async () => allowed,
    reportError: failure => { failures.push(failure); },
  };
  if (readFails) ports.config.get = async () => { throw new Error('Ledger unavailable'); };
  const app = express();
  // Express 5 leaves an unparsed body undefined; Express 4 always assigns {}, so pin that shape explicitly.
  if (bodyless) app.use((request, _response, next) => { Object.defineProperty(request, 'body', { get: () => undefined, set: () => undefined }); next(); });
  registerConsentHttp({ app, ports }, { delivery, ...register });
  const html = '<html><head></head><body><script data-consent-category="analytics" src="https://tags.example/a.js"></script></body></html>';
  app.get('/', (_req, res) => res.type('html').send(html));
  app.get('/buffer', (_req, res) => res.type('html').send(Buffer.from(html)));
  app.get('/end', (_req, res) => res.type('html').end(Buffer.from(html)));
  app.get('/stream', (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.flushHeaders(); Readable.from([html.slice(0, 30), html.slice(30)]).pipe(res); });
  app.get('/headerless', (_req, res) => { res.write(Buffer.from('<h')); res.end(new Uint8Array(Buffer.from(html.slice(2)))); });
  app.get('/late-json', (_req, res) => { res.write('{'); res.type('json'); res.end('\"ok\":true}'); });
  app.get('/gzip', (_req, res) => res.type('html').set('Content-Encoding', 'x-legacy').send(html));
  app.get('/identity', (_req, res) => res.type('html').set('Content-Encoding', 'identity').send(html));
  app.get('/binary', (_req, res) => res.type('application/octet-stream').end(Buffer.from('binary')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-http-'));
  await fs.writeFile(path.join(directory, 'preview.html'), html);
  app.get('/file', (_req, res) => res.sendFile(path.join(directory, 'preview.html')));
  closers.push(() => fs.rm(directory, { recursive: true, force: true }));
  app.get('/admin', (_req, res) => res.type('html').send(html));
  app.get('/api/fixture', (_req, res) => res.json({ html }));
  app.get('/missing', (_req, res) => res.status(404).type('html').send(html));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server address missing.');
  return { base: `http://127.0.0.1:${address.port}`, records, failures, html, ports };
}

async function choose(base: string, action: string, headers: Record<string, string> = {}, fields: Record<string, string> = {}) {
  return fetch(`${base}/api/site-consent`, { method: 'POST', redirect: 'manual', headers: { origin: 'https://site.example', 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ action, policyVersion: '1', ...fields }) });
}

describe('consent HTTP lifecycle', () => {
  it('covers public/error HTML with private/no-store and leaves admin/API/disabled delivery unchanged', async () => {
    const { base, html } = await site();
    const response = await fetch(base);
    expect(await response.text()).toContain('<template data-jini-consent-script');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie, Sec-GPC');
    expect(await (await fetch(`${base}/admin`)).text()).toBe(html);
    expect(await (await fetch(`${base}/api/fixture`)).json()).toEqual({ html });
    expect(await (await fetch(`${base}/missing`)).text()).toContain('<template data-jini-consent-script');
    const off = await site({ enabled: false });
    expect(await (await fetch(off.base)).text()).toBe(html);
    expect((await choose(off.base, 'accept')).status).toBe(409);
  });
  it('no-JS reject durably stores evidence before the HttpOnly cookie and same-origin redirect', async () => {
    const { base, records } = await site();
    const response = await choose(base, 'reject', { referer: 'https://site.example/blog?lang=en' });
    expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/blog?lang=en');
    expect(records.get(accepted.id)).toEqual({ ...accepted, action: 'reject', choices: { necessary: true, functional: false, analytics: false, marketing: false } });
    expect(response.headers.get('set-cookie')).toContain(`jini_consent=${accepted.id}`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly'); expect(response.headers.get('set-cookie')).toContain('SameSite=Lax'); expect(response.headers.get('set-cookie')).toContain('Secure');
  });
  it('stored grants survive a page request and GPC wins over both accepted proof and future saves', async () => {
    const { base, records } = await site();
    const response = await choose(base, 'accept', { accept: 'application/json', 'sec-gpc': '1', 'x-edge-region': 'US-CA' });
    const expected = { ...accepted, regionMode: 'opt-out', gpc: true, choices: { necessary: true, functional: true, analytics: false, marketing: false } };
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ record: expected, signals: googleConsentSignals({ choices: expected.choices }) }); expect(records.get(accepted.id)).toEqual(expected);
    const html = await (await fetch(base, { headers: { cookie: `jini_consent=${accepted.id}` } })).text();
    expect(html).toContain('"hasRecord":true'); expect(html).toContain('"analytics":false'); expect(html).toContain('"marketing":false');
  });
  it('refuses origin spoofing, malformed actions and changed policies without setting a cookie or writing proof', async () => {
    const { base, records } = await site();
    expect((await choose(base, 'accept', { origin: 'https://evil.example' })).status).toBe(403);
    const policy = await choose(base, 'accept', {}, { policyVersion: '2' });
    expect(policy.status).toBe(400); expect(await policy.json()).toEqual({ error: 'The privacy policy changed. Reload this page and choose again.' }); expect(policy.headers.get('set-cookie')).toBeNull();
    expect((await choose(base, 'fake')).status).toBe(400); expect(records.size).toBe(0);
    const limited = await site({ allowed: false });
    const response = await choose(limited.base, 'accept');
    expect(response.status).toBe(429); expect(await response.json()).toEqual({ error: 'Too many cookie preference changes. Please try again later.' }); expect(limited.records.size).toBe(0);
  });
  it('a failed durable save never issues a grant, while a failed read refuses to serve ungated HTML', async () => {
    const save = await site({ saveFails: true });
    const response = await choose(save.base, 'accept', { accept: 'application/json' });
    expect(response.status).toBe(500); expect(response.headers.get('set-cookie')).toBeNull(); expect(save.records.size).toBe(0);
    expect(await response.json()).toEqual({ error: 'Cookie preferences could not be saved. Your previous choices still apply. Please try again.' });
    expect(save.failures[0]?.operation).toBe('save');
    const read = await site({ readFails: true });
    const denied = await fetch(read.base);
    expect(denied.status).toBe(200); expect(await denied.text()).toContain('<template data-jini-consent-script'); expect(read.failures[0]?.operation).toBe('read');
  });
});


describe('availability and delivery regressions', () => {
  it('last-known OFF survives a later settings-read failure without gating or receipt access', async () => {
    const { base, html, ports, failures } = await site({ enabled: false });
    expect(await (await fetch(base)).text()).toBe(html);
    ports.config.get = async () => { throw new Error('Ledger unavailable'); };
    ports.records.read = async () => { throw new Error('An OFF site must not read proof.'); };
    const response = await fetch(base, { headers: { cookie: `jini_consent=${accepted.id}` } });
    expect(response.status).toBe(200); expect(await response.text()).toBe(html);
    expect(failures.map(entry => entry.operation)).toEqual(['read']);
  });
  it('failed ON settings override opt-out and saved acceptance with denied defaults while preserving the page', async () => {
    const { base, ports, records, failures } = await site();
    records.set(accepted.id, accepted);
    ports.config.get = async () => ({ ...config, regionMode: 'opt-out' });
    await fetch(base);
    ports.config.get = async () => { throw new Error('Malformed policy version'); };
    const response = await fetch(base, { headers: { cookie: `jini_consent=${accepted.id}`, 'x-edge-region': 'US-CA' } });
    const html = await response.text();
    expect(response.status).toBe(200); expect(html).toContain('"marketing":false'); expect(html).toContain('"hasRecord":false'); expect(failures.length).toBe(1);
  });
  it.each(['corrupt', 'oversized', 'io', 'shape'])('treats %s proof as absent and denies optional content even in opt-out regions', async kind => {
    const { base, ports, failures } = await site();
    ports.config.get = async () => ({ ...config, regionMode: 'opt-out' });
    ports.records = createConsentFileRecords({ directory: '/test-proof', files: { readText: async () => { if (kind === 'io') throw new Error('EIO'); return kind === 'corrupt' ? '{broken' : kind === 'shape' ? '{}' : 'x'.repeat(4097); }, writeJson: async () => { throw new Error('GET must not save.'); } } });
    const response = await fetch(base, { headers: { cookie: `jini_consent=${accepted.id}` } });
    const html = await response.text();
    expect(response.status).toBe(200); expect(html).toContain('"hasRecord":false'); expect(html).toContain('"marketing":false'); expect(failures.map(entry => entry.operation)).toEqual(['read']);
  });
  it('a cookie whose receipt is unavailable is denied in opt-out regions, unlike a new visitor', async () => {
    const { base, ports, failures } = await site();
    ports.config.get = async () => ({ ...config, regionMode: 'opt-out' });
    const fresh = await (await fetch(base)).text();
    expect(fresh).toContain('"optOut":true'); expect(fresh).toContain('"marketing":true'); expect(failures).toEqual([]);
    const evicted = await (await fetch(base, { headers: { cookie: `jini_consent=${accepted.id}` } })).text();
    expect(evicted).toContain('"hasRecord":false'); expect(evicted).toContain('"optOut":false'); expect(evicted).toContain('"marketing":false');
    expect(failures.map(entry => (entry.error as Error).message)).toEqual(['The consent receipt named by the visitor cookie is unavailable; optional content stays denied until the visitor chooses again.']);
  });
  it('gates Buffer, end, streaming and sendFile HTML while preserving status and length correctness', async () => {
    const { base } = await site();
    for (const route of ['/buffer', '/end', '/stream', '/file', '/headerless']) {
      const response = await fetch(base + route);
      const html = await response.text();
      expect(response.status).toBe(200); expect(html).toContain('<template data-jini-consent-script'); expect(html).toContain('id="jini-consent"');
      expect(response.headers.get('content-length')).toBeNull(); expect(response.headers.get('etag')).toBeNull();
    }
  });
  it('does not read policy or receipts for non-HTML public responses', async () => {
    const { base, ports, failures } = await site();
    ports.config.get = async () => { throw new Error('Non-HTML policy access'); };
    ports.records.read = async () => { throw new Error('Non-HTML proof access'); };
    const response = await fetch(base + '/binary');
    expect(response.status).toBe(200); expect(await response.text()).toBe('binary'); expect(failures).toEqual([]);
  });
  it('refuses static delivery with consent ON, and preserves static delivery with consent OFF', async () => {
    const on = await site({ delivery: 'static' });
    const response = await fetch(on.base);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe('Static export requires cookie consent to be disabled. Review optional scripts before exporting.');
    const off = await site({ delivery: 'static', enabled: false });
    expect(await (await fetch(off.base)).text()).toBe(off.html);
  });
  it('preserves a late non-HTML content type without invoking policy', async () => {
    const { base, ports, failures } = await site();
    ports.config.get = async () => { throw new Error('JSON must not read consent.'); };
    const response = await fetch(base + '/late-json');
    expect(response.status).toBe(200); expect(await response.text()).toBe('{"ok":true}'); expect(failures).toEqual([]);
  });
  it('a rejected transform caused by a throwing reporter completes with original HTML and restrictive CSP', async () => {
    const { base, ports, html } = await site();
    ports.config.get = async () => { throw new Error('Policy unavailable'); };
    ports.reportError = () => { throw new Error('Reporter unavailable'); };
    const response = await fetch(base, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(200); expect(await response.text()).toBe(html);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
    expect(response.headers.get('content-length')).toBeNull(); expect(response.headers.get('etag')).toBeNull();
  });
  it('write throttling never prevents public page delivery or receipt status', async () => {
    const { base, ports } = await site({ allowed: false });
    ports.allowWrite = async () => { throw new Error('Limiter unavailable'); };
    const response = await fetch(base);
    expect(response.status).toBe(200); expect(await response.text()).toContain('id="jini-consent"');
    expect((await fetch(base + '/api/site-consent/status')).status).toBe(200);
  });
});


describe('choice and delivery boundaries', () => {
  it('accepts a Referer-only same-origin save; refuses no source and malformed origins', async () => {
    const { base, records } = await site();
    const referer = await fetch(`${base}/api/site-consent`, { method: 'POST', redirect: 'manual', headers: { referer: 'https://site.example/page', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'reject', policyVersion: '1' }) });
    expect(referer.status).toBe(303); expect(referer.headers.get('location')).toBe('/page'); expect(records.size).toBe(1);
    const none = await fetch(`${base}/api/site-consent`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'reject', policyVersion: '1' }) });
    expect(none.status).toBe(403);
    expect((await choose(base, 'reject', { origin: 'not a url' })).status).toBe(403);
  });
  it('redirects home without a Referer, for a cross-origin Referer, and for a // path', async () => {
    const { base } = await site();
    expect((await choose(base, 'reject')).headers.get('location')).toBe('/');
    expect((await choose(base, 'reject', { referer: 'https://evil.example/page' })).headers.get('location')).toBe('/');
    expect((await choose(base, 'reject', { referer: 'https://site.example//evil.example/page' })).headers.get('location')).toBe('/');
  });
  it('a throwing record port is a 400 with its message, or a generic message for non-Error throws', async () => {
    const { base, ports } = await site();
    ports.ids.newId = () => { throw new Error('No id available.'); };
    const named = await choose(base, 'accept');
    expect(named.status).toBe(400); expect(await named.json()).toEqual({ error: 'No id available.' });
    ports.ids.newId = () => { throw 'opaque'; };
    const opaque = await choose(base, 'accept');
    expect(opaque.status).toBe(400); expect(await opaque.json()).toEqual({ error: 'Invalid cookie preferences.' });
  });
  it('an absent request body is treated as no fields and refused', async () => {
    const { base, records } = await site({ bodyless: true });
    const response = await choose(base, 'accept');
    expect(response.status).toBe(400); expect(records.size).toBe(0);
  });
  it('compressed HTML is delivered unchanged under the blocking policy; identity encoding is gated', async () => {
    const { base, html, failures } = await site();
    const gzip = await fetch(`${base}/gzip`);
    expect(gzip.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(Buffer.from(await gzip.arrayBuffer()).toString('utf8')).toBe(html);
    expect(failures.map(entry => (entry.error as Error).message)).toEqual(['Consent requires uncompressed HTML.']);
    expect(await (await fetch(`${base}/identity`)).text()).toContain('<template data-jini-consent-script');
  });
  it('passes request nonces, manifest scripts and theme origins to the gate', async () => {
    const seen: string[] = [];
    const dynamic = await site({ register: { nonce: ({ request }) => { seen.push(request.path); return 'n-1'; }, necessaryScripts: [{ src: 'https://tags.example/a.js' }], resourceOrigins: ['https://theme.example'], categoryOrigins: { analytics: ['https://collect.example'] } } });
    const html = await (await fetch(dynamic.base)).text();
    expect(seen).toEqual(['/']); expect(html).toContain('nonce="n-1"'); expect(html).toContain('https://theme.example'); expect(html).toContain('https://collect.example');
    expect(html).not.toContain('<template data-jini-consent-script');
    const fixed = await site({ register: { nonce: 'n-2' } });
    expect(await (await fetch(fixed.base)).text()).toContain('nonce="n-2"');
  });
});

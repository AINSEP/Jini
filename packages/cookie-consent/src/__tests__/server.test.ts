import { describe, expect, test } from 'vitest';
import { REGION_KIND, type RegionResolver } from '../contract.js';
import { DAY_MS } from '../policy.js';
import { handleReceipt, headerResolver, readConsent, REGION_SLOT, resolveRegion, type ConsentRecord, type ConsentRecordPort, type ReceiptPorts } from '../server/index.js';

const ORIGIN = 'https://site.example';
const NOW = 1_800_000_000_000;
const PREVIOUS = 'previous-receipt-0001';

/** In-memory record store fake; `failRetire` makes retire() reject. */
function memoryStore({ failRetire = false, withRetire = true } = {}) {
  const saved: ConsentRecord[] = [];
  const retired: string[] = [];
  const store: ConsentRecordPort = {
    async save({ record }) { saved.push(record); },
    ...(withRetire ? { async retire({ id }: { id: string }) { if (failRetire) throw new Error('disk'); retired.push(id); } } : {}),
  };
  return { store, saved, retired };
}
const ports = (store: ConsentRecordPort, over: Partial<ReceiptPorts> = {}): ReceiptPorts =>
  ({ store, policy: () => 'p1', ids: () => 'receipt-new-000000001', now: () => NOW, ...over });
function post(body: unknown, headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}/_consent`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, ...init });
}
const choice = { policy: 'p1', action: 'accept' };

describe('handleReceipt', () => {
  test('201 with the receipt id, no Set-Cookie, and evidence without IP or user agent', async () => {
    const { store, saved } = memoryStore();
    const res = await handleReceipt({ request: post(choice, { 'user-agent': 'UA', cookie: 'jini_region=us' }), ports: ports(store) });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: 'receipt-new-000000001' });
    expect(saved).toEqual([{ id: 'receipt-new-000000001', timestamp: new Date(NOW).toISOString(), policyVersion: 'p1', regionMode: 'opt-out',
      gpc: false, action: 'accept', choices: { necessary: true, functional: true, analytics: true, marketing: true } }]);
  });

  test('GPC from the header or the body clamps the stored choices', async () => {
    for (const request of [post(choice, { 'sec-gpc': '1' }), post({ ...choice, gpc: true })]) {
      const { store, saved } = memoryStore();
      await handleReceipt({ request, ports: ports(store) });
      expect(saved[0]).toMatchObject({ gpc: true, choices: { analytics: false, marketing: false, functional: true } });
    }
  });

  test('save keeps only literal-true picks; malformed choices count as none', async () => {
    const { store, saved } = memoryStore();
    await handleReceipt({ request: post({ policy: 'p1', action: 'save', choices: { functional: false, analytics: true, marketing: false } }), ports: ports(store) });
    await handleReceipt({ request: post({ policy: 'p1', action: 'save', choices: { analytics: true } }), ports: ports(store) });
    expect(saved.map(r => r.choices.analytics)).toEqual([true, false]);
  });

  test('region: options.region wins, then the configured mode, then the region cookie; unknown = opt-in', async () => {
    const regions: string[] = [];
    for (const [headers, options] of [
      [{ cookie: 'jini_region=us' }, { region: async () => 'opt-in' as const }],
      [{ cookie: 'jini_region=us' }, { regionMode: 'opt-in' as const }],
      [{ cookie: 'a=b; jini_region=us' }, {}],
      [{ cookie: 'jini_region=%E0%A4%A' }, {}],
      [{}, {}],
    ] as const) {
      const { store, saved } = memoryStore();
      await handleReceipt({ request: post(choice, headers), ports: ports(store) }, options);
      regions.push(saved[0]!.regionMode);
    }
    expect(regions).toEqual(['opt-in', 'opt-in', 'opt-out', 'opt-in', 'opt-in']);
  });

  test('a superseded receipt is retired; a failed retire never fails the new choice', async () => {
    const ok = memoryStore();
    await handleReceipt({ request: post({ ...choice, previousId: PREVIOUS }), ports: ports(ok.store) });
    expect(ok.retired).toEqual([PREVIOUS]);
    const failing = memoryStore({ failRetire: true });
    expect((await handleReceipt({ request: post({ ...choice, previousId: PREVIOUS }), ports: ports(failing.store) })).status).toBe(201);
    expect(failing.saved).toHaveLength(1);
  });

  test('retire is skipped for an invalid previousId or a store without retire()', async () => {
    const bad = memoryStore();
    for (const previousId of ['../../etc', 7, 'short']) await handleReceipt({ request: post({ ...choice, previousId }), ports: ports(bad.store) });
    expect(bad.retired).toEqual([]);
    const none = memoryStore({ withRetire: false });
    expect((await handleReceipt({ request: post({ ...choice, previousId: PREVIOUS }), ports: ports(none.store) })).status).toBe(201);
  });

  test('refusals: 405, 403, 429, 415, 413, 400, 409 with no record saved', async () => {
    const { store, saved } = memoryStore();
    const status = async (request: Request, options = {}) => {
      const res = await handleReceipt({ request, ports: ports(store) }, options);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(typeof (await res.json()).error).toBe('string');
      return res.status;
    };
    expect(await status(new Request(`${ORIGIN}/_consent`, { method: 'GET', headers: { origin: ORIGIN } }))).toBe(405);
    expect(await status(post(choice, { origin: 'https://evil.example' }))).toBe(403);
    expect(await status(new Request(`${ORIGIN}/_consent`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }))).toBe(403);
    expect(await status(post(choice), { allow: async () => false })).toBe(429);
    expect(await status(post(choice, { 'content-type': 'text/plain' }))).toBe(415);
    expect(await status(new Request(`${ORIGIN}/_consent`, { method: 'POST', body: '{}', headers: { origin: ORIGIN } }))).toBe(415);
    expect(await status(new Request(`${ORIGIN}/_consent`, { method: 'POST', headers: { origin: ORIGIN } }))).toBe(415);
    expect(await status(post(choice, { 'content-length': '5000' }))).toBe(413);
    expect(await status(post({ ...choice, pad: 'x'.repeat(100) }), { maxBytes: 64 })).toBe(413);
    for (const body of ['{', '[]', 'null', '"x"']) expect(await status(post(body))).toBe(400);
    expect(await status(post({ policy: 'p1', action: 'grant' }))).toBe(400);
    expect(await status(post({ policy: 'p0', action: 'accept' }))).toBe(409);
    expect(saved).toEqual([]);
  });

  test('an allowed request passes the host rate limit', async () => {
    const { store } = memoryStore();
    expect((await handleReceipt({ request: post(choice), ports: ports(store, { policy: async () => 'p1' }) }, { allow: () => true })).status).toBe(201);
  });
});

describe('readConsent', () => {
  const stored = (over: object = {}) => `jini_choices=${encodeURIComponent(JSON.stringify({ v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: true }, t: NOW, a: 'accept', r: 'receipt-0000000001', ...over }))}`;
  const read = (cookieHeader: string | null, optional = {}) => readConsent({ cookieHeader, policy: 'p1', regionMode: 'auto' }, { nowMs: NOW, ...optional });

  test('a receipted grant is allowed; an unconfirmed one is not', () => {
    expect(read(stored()).allowed.analytics).toBe(true);
    expect(read(stored({ r: undefined, q: 1 })).allowed.analytics).toBe(false);
  });

  test('the old engine cookie never supplies a choice, even if it contains new-format data', () => {
    for (const legacy of ['jini_consent=old_receipt_0123456789', stored().replace('jini_choices=', 'jini_consent=')]) {
      expect(read(legacy)).toMatchObject({ status: 'pending', action: null, allowed: { analytics: false } });
      expect(read(`${legacy}; ${stored()}`)).toMatchObject({ status: 'set', action: 'accept', allowed: { analytics: true } });
    }
  });

  test('GPC clamps; region comes from the hint or the region cookie', () => {
    expect(read(stored(), { secGpc: '1' }).allowed.analytics).toBe(false);
    expect(read('jini_region=us').region).toBe('opt-out');
    expect(read('jini_region=us', { regionHint: null }).region).toBe('opt-in');
    expect(read(null, { regionHint: 'us' }).region).toBe('opt-out');
    expect(read(undefined as never).status).toBe('pending');
  });

  test('expired choices are no choice; the default clock and max age apply when omitted', () => {
    expect(read(stored({ t: NOW - 2 * DAY_MS }), { maxAgeMs: DAY_MS }).status).toBe('pending');
    expect(readConsent({ cookieHeader: stored({ t: Date.now() }), policy: 'p1', regionMode: 'opt-in' }).status).toBe('set');
  });
});

describe('region resolvers', () => {
  const request = (headers: Record<string, string> = {}) => ({ header: (name: string) => headers[name] ?? null, ip: null });
  const live = (resolve: RegionResolver['resolve']): RegionResolver => ({ id: 'r', kind: REGION_KIND, resolve });

  test('headerResolver: US values => us, other countries => strict, XX/T1/missing defer', () => {
    const r = headerResolver({ id: 'h', header: 'x-country' });
    expect(r.resolve({ request: request({ 'x-country': ' us ' }) })).toBe('us');
    expect(r.resolve({ request: request({ 'x-country': 'DE' }) })).toBe('strict');
    for (const value of ['XX', 't1', '']) expect(r.resolve({ request: request({ 'x-country': value }) })).toBeNull();
    expect(r.resolve({ request: request() })).toBeNull();
    expect(headerResolver({ id: 'h', header: 'x-c' }, { usValues: ['pr'] }).resolve({ request: request({ 'x-c': 'PR' }) })).toBe('us');
  });

  test('REGION_SLOT accepts live resolvers and the data form; refuses anything else', () => {
    const resolver = live(() => 'us');
    expect(REGION_SLOT.accept({ contribution: resolver as never })).toBe(resolver);
    const data = REGION_SLOT.accept({ contribution: { id: 'd', kind: REGION_KIND, header: 'x-country-code', usValues: ['US', 'PR'] } }) as RegionResolver;
    expect(data.resolve({ request: request({ 'x-country-code': 'PR' }) })).toBe('us');
    expect(REGION_SLOT.accept({ contribution: { id: 'd', kind: REGION_KIND, header: 'bad header' } })).toMatch(/resolve\(\) or a header name/);
    expect(typeof REGION_SLOT.accept({ contribution: { id: 'd', kind: REGION_KIND } })).toBe('string');
  });

  test('resolveRegion: first definite answer in order; a deferral asks the next', async () => {
    const asked: string[] = [];
    const resolvers = [live(() => { asked.push('a'); return null; }), live(async () => { asked.push('b'); return 'us'; }), live(() => { asked.push('c'); return 'strict'; })];
    expect(await resolveRegion({ resolvers, request: request() })).toBe('us');
    expect(asked).toEqual(['a', 'b']);
    const header = headerResolver({ id: 'h', header: 'x-country' });
    expect(await resolveRegion({ resolvers: [header, live(() => 'us')], request: request({ 'x-country': 'XX' }) })).toBe('us');
  });

  test('resolveRegion is strict on throw, rejection, timeout or nobody knowing', async () => {
    expect(await resolveRegion({ resolvers: [], request: request() })).toBe('strict');
    expect(await resolveRegion({ resolvers: [live(() => null)], request: request() })).toBe('strict');
    expect(await resolveRegion({ resolvers: [live(() => { throw new Error('x'); }), live(() => 'us')], request: request() })).toBe('strict');
    expect(await resolveRegion({ resolvers: [live(async () => { throw new Error('x'); })], request: request() })).toBe('strict');
    let signal: AbortSignal | undefined;
    const slow = live((_r, optional) => { signal = optional?.signal; return new Promise(resolve => setTimeout(() => resolve('us'), 200)); });
    expect(await resolveRegion({ resolvers: [slow], request: request() }, { timeoutMs: 5 })).toBe('strict');
    expect(signal?.aborted).toBe(true);
  });
});

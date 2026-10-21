import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readRequestConsentChoices, type ConsentHttpPorts } from '../express/index.js';
import { DENIED_CHOICES, type ConsentConfig, type ConsentRecord } from '../types.js';
import { accepted, config, now } from './fixtures.js';

const ALL = { necessary: true, functional: true, analytics: true, marketing: true };

/** Only `get` is read from the request, so a header map stands in for Express. */
function fakeRequest(headers: Record<string, string> = {}): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

type FakeOptions = { configOverride?: Partial<ConsentConfig>; records?: ConsentRecord[]; configFails?: boolean };
function fakePorts({ configOverride = {}, records = [], configFails = false }: FakeOptions = {}) {
  const stored = new Map(records.map(record => [record.id, record]));
  const failures: Array<{ operation: string; error: unknown }> = [];
  const ports: Parameters<typeof readRequestConsentChoices>[0]['ports'] = {
    config: { get: async () => { if (configFails) throw new Error('Ledger unavailable'); return { ...config, ...configOverride }; } },
    records: { read: async ({ id }) => stored.get(id) ?? null, save: async () => undefined },
    clock: { nowIso: () => now, nowMs: () => Date.parse(now) },
    readReceiptId: ({ cookieHeader }) => cookieHeader.match(/jini_consent=([a-zA-Z0-9_-]+)/)?.[1] ?? null,
    region: ({ request }) => request.get('x-edge-region') ?? null,
    reportError: failure => { failures.push(failure); },
  };
  return { ports, failures };
}

const rejected: ConsentRecord = { ...accepted, id: 'receipt_rejected_0123456789', action: 'reject', choices: { ...DENIED_CHOICES } };

describe('readRequestConsentChoices', () => {
  it('grants every category when consent is disabled, matching the ungated page path', async () => {
    const { ports, failures } = fakePorts({ configOverride: { enabled: false } });
    expect(await readRequestConsentChoices({ ports, request: fakeRequest({ 'sec-gpc': '1' }) })).toEqual(ALL);
    expect(failures).toEqual([]);
  });

  it('reads an accept receipt from the default cookie as an analytics grant', async () => {
    const { ports, failures } = fakePorts({ records: [accepted] });
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest({ cookie: `jini_consent=${accepted.id}` }) });
    expect(choices).toEqual(ALL);
    expect(failures).toEqual([]);
  });

  it('honours a stored rejection even in an opt-out region', async () => {
    const { ports } = fakePorts({ records: [rejected] });
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest({ cookie: `jini_consent=${rejected.id}`, 'x-edge-region': 'US-CA' }) });
    expect(choices).toEqual(DENIED_CHOICES);
  });

  it('denies optional categories to an opt-in visitor without a cookie', async () => {
    const { ports, failures } = fakePorts();
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest() });
    expect(choices).toEqual(DENIED_CHOICES);
    expect(choices.analytics).toBe(false);
    expect(failures).toEqual([]);
  });

  it('allows optional categories to an opt-out region visitor without a cookie', async () => {
    const { ports } = fakePorts();
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest({ 'x-edge-region': 'US-CA' }) });
    expect(choices).toEqual(ALL);
  });

  it('treats a cookie whose receipt is missing as failed proof, denied even in an opt-out region', async () => {
    const { ports, failures } = fakePorts();
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest({ cookie: 'jini_consent=receipt_evicted_0123456789', 'x-edge-region': 'US-CA' }) });
    expect(choices).toEqual(DENIED_CHOICES);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.operation).toBe('read');
    expect(String(failures[0]?.error)).toContain('unavailable');
  });

  it('lets the Sec-GPC header deny analytics and marketing despite an accept receipt', async () => {
    const { ports } = fakePorts({ records: [accepted] });
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest({ cookie: `jini_consent=${accepted.id}`, 'sec-gpc': '1' }) });
    expect(choices.analytics).toBe(false);
    expect(choices.marketing).toBe(false);
    expect(choices.necessary).toBe(true);
  });

  it('reads a custom cookie name and ignores the default one', async () => {
    const { ports } = fakePorts({ records: [accepted] });
    ports.readReceiptId = ({ cookieHeader }) => cookieHeader.match(/site_consent=([a-zA-Z0-9_-]+)/)?.[1] ?? null;
    const request = fakeRequest({ cookie: `site_consent=${accepted.id}` });
    expect(await readRequestConsentChoices({ ports, request }, { cookieName: 'site_consent' })).toEqual(ALL);
  });

  it('returns a fresh denied object and reports the error when config.get throws', async () => {
    const { ports, failures } = fakePorts({ configFails: true, records: [accepted] });
    const choices = await readRequestConsentChoices({ ports, request: fakeRequest({ cookie: `jini_consent=${accepted.id}`, 'x-edge-region': 'US-CA' }) });
    expect(choices).toEqual(DENIED_CHOICES);
    expect(choices).not.toBe(DENIED_CHOICES);
    expect(Object.isFrozen(choices)).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.operation).toBe('read');
    expect((failures[0]?.error as Error).message).toBe('Ledger unavailable');
  });

  it('never throws when the region port throws; it reports and denies', async () => {
    const { ports, failures } = fakePorts();
    ports.region = () => { throw new Error('Edge header unreadable'); };
    await expect(readRequestConsentChoices({ ports, request: fakeRequest() })).resolves.toEqual(DENIED_CHOICES);
    expect(failures.map(failure => (failure.error as Error).message)).toEqual(['Edge header unreadable']);
  });

  it('accepts a full ConsentHttpPorts bag', async () => {
    const { ports } = fakePorts();
    const full: ConsentHttpPorts = { ...ports, ids: { newId: () => 'unused' }, origin: () => 'https://site.example', allowWrite: async () => true };
    expect(await readRequestConsentChoices({ ports: full, request: fakeRequest() })).toEqual(DENIED_CHOICES);
  });
});

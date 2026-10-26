import type { Express, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { allowsAnalyticsProof, readRequestAnalyticsProof, registerConsentHttp, type ConsentHttpPorts } from '../express/index.js';
import { createConsentFileRecords } from '../node/index.js';
import { CONSENT_MAX_AGE_MS, type ConsentRecord } from '../types.js';
import { accepted, config, now } from './fixtures.js';

function fixture() {
  const active = new Map<string, ConsentRecord>([[accepted.id, accepted]]);
  const retired = new Map<string, ConsentRecord>();
  const order: string[] = [];
  let policy = config.policyVersion, time = Date.parse(now);
  const ports: ConsentHttpPorts = {
    config: { get: async () => ({ ...config, policyVersion: policy }) },
    records: {
      read: async ({ id }) => active.get(id) ?? null,
      save: async ({ record }) => { order.push('save'); active.set(record.id, record); },
      retire: async ({ id }) => { order.push('retire'); const record = active.get(id); if (record) retired.set(id, record); active.delete(id); },
    },
    clock: { nowIso: () => new Date(time).toISOString(), nowMs: () => time },
    ids: { newId: () => ['replacement', 'receipt', '0123456789'].join('_') },
    readReceiptId: ({ cookieHeader }) => cookieHeader.match(/jini_consent=([a-zA-Z0-9_-]+)/)?.[1] ?? null,
    origin: () => 'https://site.example', region: () => 'US-CA', allowWrite: async () => true, reportError() {},
  };
  const request = (headers: Record<string, string> = {}) => ({
    get: (name: string) => ({ cookie: `jini_consent=${accepted.id}`, origin: 'https://site.example', accept: 'application/json', ...headers })[name],
    body: { action: 'reject', policyVersion: config.policyVersion },
  }) as unknown as Request;
  return { ports, request, retired, order, policy: (value: string) => { policy = value; }, time: (value: number) => { time = value; } };
}

describe('analytics delivery uses existing explicit consent evidence', () => {
  it('requires a receipt even in opt-out regions, and DNT/GPC override an accepted receipt', async () => {
    const f = fixture();
    expect(await readRequestAnalyticsProof({ ports: f.ports, request: f.request({ cookie: '' }) })).toBeUndefined();
    for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
      expect(await readRequestAnalyticsProof({ ports: f.ports, request: f.request(headers) })).toBeUndefined();
    }
    expect(await readRequestAnalyticsProof({ ports: f.ports, request: f.request() })).toEqual({ receiptId: accepted.id, policyVersion: '1' });
  });

  it('rechecks policy changes, expiry and unavailable storage before delayed delivery', async () => {
    const f = fixture(), proof = { receiptId: accepted.id, policyVersion: '1' };
    expect(await allowsAnalyticsProof({ ports: f.ports, proof })).toBe(true);
    f.policy('2'); expect(await allowsAnalyticsProof({ ports: f.ports, proof })).toBe(false);
    f.policy('1'); f.time(Date.parse(now) + CONSENT_MAX_AGE_MS + 1);
    expect(await allowsAnalyticsProof({ ports: f.ports, proof })).toBe(false);
    f.ports.records.read = async () => { throw new Error('unavailable'); };
    expect(await allowsAnalyticsProof({ ports: f.ports, proof })).toBe(false);
  });

  it('retires the previous proof before acknowledging a replacement, without overwriting evidence', async () => {
    const f = fixture(), proof = { receiptId: accepted.id, policyVersion: '1' };
    let choose!: (request: Request, response: Response) => Promise<void>;
    const app = { get() {}, use() {}, post(_path: string, ...handlers: unknown[]) { choose = handlers.at(-1) as typeof choose; } } as unknown as Express;
    registerConsentHttp({ app, ports: f.ports });
    const response = { set() { return this; }, cookie() { f.order.push('cookie'); return this; }, json() { f.order.push('response'); return this; } } as unknown as Response;
    await choose(f.request(), response);
    expect(f.order).toEqual(['save', 'retire', 'cookie', 'response']);
    expect(f.retired.get(accepted.id)).toEqual(accepted);
    expect(await allowsAnalyticsProof({ ports: f.ports, proof })).toBe(false);
  });

  it('does not authorize detached delivery through an adapter that cannot retire old grants', async () => {
    const f = fixture(); delete f.ports.records.retire;
    expect(await readRequestAnalyticsProof({ ports: f.ports, request: f.request() })).toBeUndefined();
    expect(await allowsAnalyticsProof({ ports: f.ports, proof: { receiptId: accepted.id, policyVersion: '1' } })).toBe(false);
  });
});

it('the file-record adapter retires only its validated active filename', async () => {
  const paths: string[] = [];
  const records = createConsentFileRecords({ directory: '/site/receipts', files: {
    readText: async () => null, writeJson: async () => {}, retire: async ({ filePath }) => { paths.push(filePath); },
  } });
  await records.retire!({ id: accepted.id });
  expect(paths).toEqual([`/site/receipts/${accepted.id}.json`]);
  await expect(records.retire!({ id: '../escape' })).rejects.toThrow('Invalid consent receipt ID.');
});

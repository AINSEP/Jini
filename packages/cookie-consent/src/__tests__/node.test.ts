// MOVED-FROM: @jini-ai/cms consent/__tests__/records.test.ts, with the node module it covers. TODO(P4): delete the cms copy.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { createConsentFileRecords, createNodeConsentFiles, consentRateLimitKey, readConsentReceiptStorage, type ConsentFilePorts } from '../node/index.js';
import { DEFAULT_MAX_AGE_MS as CONSENT_MAX_AGE_MS } from '../policy.js';
import type { ConsentRecord } from '../server/index.js';

const accepted: ConsentRecord = { id: 'receipt_01234567890123456789', timestamp: '2026-10-26T00:00:00.000Z', policyVersion: '1', regionMode: 'opt-in', gpc: false, action: 'accept', choices: { necessary: true, functional: true, analytics: true, marketing: true } };

describe('consent proof storage', () => {
  it('retires active proof while preserving immutable evidence through the bounded file writer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-retire-'));
    const files = createNodeConsentFiles({ atomicWrite: async ({ filePath, data }, options) => {
      if (options.createParent) await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data), { mode: options.mode });
    } });
    const records = createConsentFileRecords({ directory: root, files });
    try {
      await records.save({ record: accepted });
      await records.retire!({ id: accepted.id });
      expect(await records.read({ id: accepted.id })).toBe(null);
      expect(JSON.parse(await fs.readFile(path.join(root, 'retired', `${accepted.id}.json`), 'utf8'))).toEqual(accepted);
      await expect(records.retire!({ id: accepted.id })).resolves.toBeUndefined();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('creates a private receipt directory and counts only stored receipt files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-health-'));
    const directory = path.join(root, 'receipts');
    try {
      expect(await readConsentReceiptStorage({ directory })).toEqual({ writable: true, count: 0 });
      await fs.writeFile(path.join(directory, `${accepted.id}.json`), JSON.stringify(accepted));
      await fs.writeFile(path.join(directory, '.pending_receipt_0123456789.json'), '{}');
      await fs.writeFile(path.join(directory, 'unrelated.json'), '{}');
      await fs.mkdir(path.join(directory, 'directory_receipt_0123456789.json'));
      expect(await readConsentReceiptStorage({ directory })).toEqual({ writable: true, count: 1 });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('rejects unwritable or unreadable receipt storage instead of reporting it healthy', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-health-'));
    const denied = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    try {
      await expect(readConsentReceiptStorage({ directory }, { filesystem: { ...fs, access: async () => { throw denied; } } })).rejects.toBe(denied);
      await expect(readConsentReceiptStorage({ directory }, { filesystem: { ...fs, readdir: async () => { throw denied; } } })).rejects.toBe(denied);
      const blocker = path.join(directory, 'file');
      await fs.writeFile(blocker, 'not a directory');
      await expect(readConsentReceiptStorage({ directory: path.join(blocker, 'receipts') })).rejects.toThrow();
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  // REGRESSION: fails if Windows receipt publication opens a directory after its hard link lands.
  it('publishes Windows receipts without opening their directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-win32-'));
    let directoryOpens = 0;
    const filesystem = { ...fs, open: (async (filePath, flags, mode) => {
      if (String(filePath) === directory && flags === 'r') { directoryOpens++; throw Object.assign(new Error('directory open denied'), { code: 'EPERM' }); }
      return fs.open(filePath, flags, mode);
    }) as typeof fs.open };
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, { filesystem, platform: 'win32' });
    try {
      const filePath = path.join(directory, `${accepted.id}.json`);
      await expect(files.writeJson({ filePath, record: accepted })).resolves.toBeUndefined();
      expect(directoryOpens).toBe(0);
      expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual(accepted);
      expect(await fs.readdir(directory)).toEqual([`${accepted.id}.json`]);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('uses the injected atomic writer, publishes only complete immutable receipts, and rejects collisions/traversal', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-'));
    const options: unknown[] = [];
    // DI fake of the atomic writer. The real platform writer has its own flush/rename tests.
    const files = createNodeConsentFiles({ atomicWrite: async (input, optional) => { options.push(optional); await fs.writeFile(input.filePath, JSON.stringify(input.data), { mode: optional.mode }); } });
    const records = createConsentFileRecords({ directory, files });
    try {
      expect(await records.read({ id: accepted.id })).toBeNull();
      await records.save({ record: accepted });
      expect(await records.read({ id: accepted.id })).toEqual(accepted);
      expect(options).toEqual([{ createParent: true, mode: 0o600, refuseSymlink: true }]);
      expect(await fs.readdir(directory)).toEqual([`${accepted.id}.json`]);
      await expect(records.save({ record: accepted })).rejects.toThrow('Consent receipt ID already exists.');
      await expect(records.read({ id: '../escape' })).rejects.toThrow('Invalid consent receipt ID.');
      await fs.writeFile(path.join(directory, `${accepted.id}.json`), 'broken json');
      await expect(records.read({ id: accepted.id })).rejects.toThrow(SyntaxError);
      await fs.writeFile(path.join(directory, `${accepted.id}.json`), 'x'.repeat(4097));
      await expect(records.read({ id: accepted.id })).rejects.toThrow('Consent receipt exceeds 4096 bytes.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('concurrent writers cannot overwrite a saved record even after both saw absence', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-'));
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } });
    try {
      const results = await Promise.allSettled([files.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: accepted }), files.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: { ...accepted, action: 'reject' } })]);
      expect(results.filter(result => result.status === 'fulfilled').length).toBe(1);
      expect(results.filter(result => result.status === 'rejected').length).toBe(1);
      expect(await fs.readdir(directory)).toEqual([`${accepted.id}.json`]);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('propagates storage errors instead of treating unreadable evidence as absence', async () => {
    const files: ConsentFilePorts = { readText: async () => { throw new Error('Permission denied'); }, writeJson: async () => { throw new Error('Disk full'); } };
    const records = createConsentFileRecords({ directory: '/proof', files });
    await expect(records.read({ id: accepted.id })).rejects.toThrow('Permission denied');
    const failed = createConsentFileRecords({ directory: '/proof', files: { ...files, readText: async () => null } });
    await expect(failed.save({ record: accepted })).rejects.toThrow('Disk full');
    const oversized = createConsentFileRecords({ directory: '/proof', files: { ...files, readText: async () => 'x'.repeat(4097) } });
    await expect(oversized.read({ id: accepted.id })).rejects.toThrow('Consent receipt exceeds 4096 bytes.');
  });
});


describe('receipt resource bounds', () => {
  it('serializes concurrent capacity checks and evicts oldest receipts without partial proof', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-cap-'));
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, { maximumRecords: 1 });
    try {
      const results = await Promise.allSettled([files.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: accepted }), files.writeJson({ filePath: path.join(directory, 'another_receipt_0123456789.json'), record: { ...accepted, id: 'another_receipt_0123456789' } })]);
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await fs.readdir(directory)).toEqual(['another_receipt_0123456789.json']);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('uses an explicit owner retention policy and preserves unrelated files and unexpired receipts', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-retain-'));
    const old = path.join(directory, 'expired_receipt_0123456789.json');
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, { maximumRecords: 1, retentionMs: 1000, nowMs: () => 10000 });
    try {
      await fs.writeFile(old, '{}'); await fs.utimes(old, new Date(0), new Date(0)); await fs.writeFile(path.join(directory, 'keep.txt'), 'unrelated');
      await files.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: accepted });
      expect((await fs.readdir(directory)).sort()).toEqual([`${accepted.id}.json`, 'keep.txt'].sort());
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('defaults retention to the cookie lifetime even below capacity', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-retention-default-'));
    const old = path.join(directory, `${accepted.id}.json`);
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, { nowMs: () => CONSENT_MAX_AGE_MS + 1 });
    try {
      await fs.writeFile(old, '{}'); await fs.utimes(old, new Date(0), new Date(0));
      await files.writeJson({ filePath: path.join(directory, 'another_receipt_0123456789.json'), record: accepted });
      expect(await fs.readdir(directory)).toEqual(['another_receipt_0123456789.json']);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('honors a longer configured retention and scans existing receipts only once across writes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-count-'));
    let scans = 0, stats = 0;
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, {
      retentionMs: CONSENT_MAX_AGE_MS * 2, nowMs: () => CONSENT_MAX_AGE_MS + 1,
      filesystem: { ...fs, readdir: (async (directoryPath: string) => { scans++; return fs.readdir(directoryPath); }) as typeof fs.readdir, stat: (async (filePath: string) => { stats++; return fs.stat(filePath); }) as typeof fs.stat } as Pick<typeof fs, 'link' | 'unlink' | 'open' | 'readdir' | 'stat'>,
    });
    try {
      const old = path.join(directory, `${accepted.id}.json`);
      await fs.writeFile(old, '{}'); await fs.utimes(old, new Date(0), new Date(0));
      for (let n = 0; n < 3; n++) await files.writeJson({ filePath: path.join(directory, `another_receipt_0123456789_${n}.json`), record: accepted });
      expect(await fs.readFile(old, 'utf8')).toBe('{}');
      expect(scans).toBe(1); expect(stats).toBe(1);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('evicts by oldest mtime rather than directory name order and preserves unrelated files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-oldest-'));
    const recent = 'aaaa_recent_receipt_0123456789.json', old = 'zzzz_old_receipt_0123456789.json';
    const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, { maximumRecords: 2, nowMs: () => 10000 });
    try {
      await fs.writeFile(path.join(directory, recent), '{}'); await fs.utimes(path.join(directory, recent), new Date(5), new Date(5));
      await fs.writeFile(path.join(directory, old), '{}'); await fs.utimes(path.join(directory, old), new Date(0), new Date(0));
      await fs.writeFile(path.join(directory, 'keep.txt'), 'unrelated');
      await files.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: accepted });
      expect((await fs.readdir(directory)).sort()).toEqual([recent, 'keep.txt', `${accepted.id}.json`].sort());
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it('groups rotating/compressed IPv6 addresses by /64, without conflating subnets or IPv4 budgets', () => {
    expect(consentRateLimitKey({ address: '2001:db8:abcd:1234::1' })).toBe('2001:db8:abcd:1234::/64');
    expect(consentRateLimitKey({ address: '2001:0DB8:abcd:1234:ffff:1234:0001:abcd' })).toBe('2001:db8:abcd:1234::/64');
    expect(consentRateLimitKey({ address: '2001:db8:abcd:1235::1' })).toBe('2001:db8:abcd:1235::/64');
    expect(consentRateLimitKey({ address: '192.0.2.1' })).toBe('192.0.2.1');
    expect(consentRateLimitKey({ address: '::ffff:192.0.2.1' })).toBe('192.0.2.1');
    expect(consentRateLimitKey({ address: '::ffff:c000:201' })).toBe('192.0.2.1');
  });
});

describe('node receipt adapter boundaries', () => {
  const atomicWrite = async (input: { filePath: string; data: unknown }) => { await fs.writeFile(input.filePath, JSON.stringify(input.data)); };
  const failing = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };
  it('refuses invalid capacity and retention', () => {
    for (const maximumRecords of [0, 1.5, Number.NaN]) expect(() => createNodeConsentFiles({ atomicWrite }, { maximumRecords })).toThrow('Consent receipt capacity must be a positive integer.');
    for (const retentionMs of [-1, Number.POSITIVE_INFINITY]) expect(() => createNodeConsentFiles({ atomicWrite }, { retentionMs })).toThrow('Consent receipt retention must be nonnegative.');
  });
  it('refuses oversized receipts before scanning the directory', async () => {
    const files = createNodeConsentFiles({ atomicWrite }, { filesystem: { ...fs, readdir: failing('EACCES') } as never });
    await expect(files.writeJson({ filePath: '/proof/oversized_receipt_0123456789.json', record: { ...accepted, policyVersion: 'x'.repeat(5000) } })).rejects.toThrow('Consent receipt exceeds 4096 bytes.');
  });
  it('a missing directory is an empty inventory; other scan failures propagate', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-scan-'));
    try {
      const missing = createNodeConsentFiles({ atomicWrite }, { filesystem: { ...fs, readdir: failing('ENOENT') } as never });
      await missing.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: accepted });
      expect(await fs.readdir(directory)).toEqual([`${accepted.id}.json`]);
      for (const error of [Object.assign(new Error('denied'), { code: 'EACCES' }), 'opaque']) {
        const denied = createNodeConsentFiles({ atomicWrite }, { filesystem: { ...fs, readdir: async () => { throw error; } } as never });
        await expect(denied.writeJson({ filePath: path.join(directory, 'another_receipt_0123456789.json'), record: accepted })).rejects.toBe(error);
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('retire ignores an active receipt that vanished meanwhile but propagates other unlink failures', async () => {
    for (const code of ['ENOENT', 'EPERM']) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-retire-unlink-'));
      const active = path.join(directory, `${accepted.id}.json`);
      try {
        const unlink = (async (filePath: string) => { if (filePath === active) throw Object.assign(new Error(code), { code }); return fs.unlink(filePath); }) as typeof fs.unlink;
        const files = createNodeConsentFiles({ atomicWrite: async input => { await fs.mkdir(path.dirname(input.filePath), { recursive: true }); await fs.writeFile(input.filePath, JSON.stringify(input.data)); } }, { filesystem: { ...fs, unlink } as never });
        await fs.writeFile(active, JSON.stringify(accepted));
        const retire = files.retire!({ filePath: active });
        if (code === 'ENOENT') await expect(retire).resolves.toBeUndefined();
        else await expect(retire).rejects.toThrow('EPERM');
        expect(JSON.parse(await fs.readFile(path.join(directory, 'retired', `${accepted.id}.json`), 'utf8'))).toEqual(accepted);
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    }
  });
  it('eviction ignores an already-removed receipt but propagates other unlink failures', async () => {
    for (const code of ['ENOENT', 'EPERM']) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-consent-evict-'));
      const old = path.join(directory, 'expired_receipt_0123456789.json');
      try {
        await fs.writeFile(old, '{}');
        const unlink = (async (filePath: string) => { if (filePath === old) throw Object.assign(new Error(code), { code }); return fs.unlink(filePath); }) as typeof fs.unlink;
        const files = createNodeConsentFiles({ atomicWrite }, { maximumRecords: 1, filesystem: { ...fs, unlink } as never });
        const write = files.writeJson({ filePath: path.join(directory, `${accepted.id}.json`), record: accepted });
        if (code === 'ENOENT') { await write; expect((await fs.readdir(directory)).sort()).toEqual(['expired_receipt_0123456789.json', `${accepted.id}.json`]); }
        else { await expect(write).rejects.toThrow('EPERM'); expect(await fs.readdir(directory)).toEqual(['expired_receipt_0123456789.json']); }
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    }
  });
});

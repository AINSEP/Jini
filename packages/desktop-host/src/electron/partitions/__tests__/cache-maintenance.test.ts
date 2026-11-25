import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDesktopCacheLimits, clearPartitionCacheOnce, createMaintenanceMarker } from '../index.js';
import type { HolderRecord, PackagedEvidence, SizeRead, StrictRead } from '../index.js';
import { MemoryFs } from './fakes.js';

const NAME = 'site-0123456789abcdef0123456789abcdef';
const ROOT = '/profile/session/Partitions';
const MiB = 2 ** 20;
const GO: PackagedEvidence = { cap: 'go', clearOps: { clearCache: 'go', clearCodeCaches: 'go' } };

function holder(token: string, held: string[] = [], intents: string[] = []): HolderRecord {
  return { v: 1, pid: 7, token, bootId: 'b', hostname: 'h', profile: '/profile', startedAt: 0, seq: 1, intents, held };
}

/** Directory renames only; `fail` maps a source path to the errno codes its next renames throw. */
function cacheFs() {
  const renamed: Array<[string, string]> = [];
  const fail = new Map<string, string[]>();
  return {
    renamed, fail, mkdirs: [] as string[],
    /** Runs at the instant of the rename: what a crash right there would leave on disk. */
    atRename: async () => {},
    async mkdir({ path: dir }: { path: string }) { this.mkdirs.push(dir); },
    async rename({ oldPath, newPath }: { oldPath: string; newPath: string }) {
      await this.atRename();
      const code = fail.get(oldPath)?.shift();
      if (code) throw Object.assign(new Error(code), { code });
      renamed.push([oldPath, newPath]);
    },
  };
}

function markerOn(fs: MemoryFs, profile: string) {
  fs.mkdirSync({ path: profile });
  return createMaintenanceMarker({ file: `${profile}/maintenance.json`, fs });
}

function bootRequired(over: { holders?: StrictRead<HolderRecord[]>; bytes?: SizeRead; profile?: string; mem?: MemoryFs; evidence?: PackagedEvidence } = {}) {
  const mem = over.mem ?? new MemoryFs();
  const fs = cacheFs();
  const writes: string[] = [];
  const marker = markerOn(mem, over.profile ?? '/profile');
  return {
    fs, mem, marker, writes,
    required: {
      partition: { name: NAME, dir: `${ROOT}/${NAME}` },
      interlock: {
        phase: 'boot' as const,
        writer: { assertHeld: async () => {}, setTarget: async ({ target }: { target: string | null }) => { writes.push(`target:${target}`); } },
        readHoldersStrict: async () => over.holders ?? { state: 'ok' as const, value: [] },
        newToken: () => 'ab12',
      },
      fs, marker,
      measure: async () => over.bytes ?? { state: 'measured' as const, bytes: 100 * MiB },
      evidence: over.evidence ?? GO,
      capBytes: 32 * MiB,
    },
  };
}

describe('applyDesktopCacheLimits', () => {
  it('T-1.2 NO-GO evidence ⇒ no switch', () => {
    for (const cap of ['no-go', 'unknown'] as const) {
      const calls: string[][] = [];
      const result = applyDesktopCacheLimits({ appendSwitch: (n, v) => { calls.push([n, v]); }, evidence: { ...GO, cap }, cacheBytes: 32 * MiB });
      expect(calls).toEqual([]);
      expect(result).toEqual({ state: 'skipped', reason: cap === 'no-go' ? 'evidence-no-go' : 'evidence-unknown' });
    }
    const calls: string[][] = [];
    expect(applyDesktopCacheLimits({ appendSwitch: (n, v) => { calls.push([n, v]); }, evidence: GO, cacheBytes: 32 * MiB }))
      .toEqual({ state: 'applied', cacheBytes: 32 * MiB });
    expect(calls).toEqual([['disk-cache-size', String(32 * MiB)]]);
  });
});

describe('clearPartitionCacheOnce at boot', () => {
  it('T-1.3 a busy partition is retried next start', async () => {
    const w = bootRequired();
    w.fs.fail.set(`${ROOT}/${NAME}/Cache`, ['EBUSY']);
    const atClear: string[] = [];
    w.fs.atRename = async () => { atClear.push((await w.marker.readCacheClear({ partition: NAME })).state); };
    expect(await clearPartitionCacheOnce(w.required)).toEqual({ state: 'pending', reason: 'busy' });
    expect(await w.marker.readCacheClear({ partition: NAME })).toMatchObject({ state: 'pending', attempts: 1, lastReason: 'busy' });
    expect(w.fs.renamed).toEqual([]);

    const next = await clearPartitionCacheOnce(w.required);
    expect(next).toMatchObject({ state: 'cleared', mode: 'one-time', aside: `${ROOT}/.removing/${NAME}.Cache.ab12` });
    expect(await w.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'done', capBytes: 32 * MiB });
    expect(await clearPartitionCacheOnce(w.required)).toEqual({ state: 'already-done' });
    expect(w.fs.renamed).toHaveLength(1);
    // A crash at either clear must leave the partition not done, so the next start clears it.
    expect(atClear).toEqual(['absent', 'pending']);
  });

  it('T-1.4 marker is per profile', async () => {
    const mem = new MemoryFs();
    const a = bootRequired({ mem, profile: '/profile-a' });
    const b = bootRequired({ mem, profile: '/profile-b' });
    expect(await clearPartitionCacheOnce(a.required)).toMatchObject({ state: 'cleared' });
    expect(await a.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'done', capBytes: 32 * MiB });
    expect(await b.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'absent' });
    expect(await clearPartitionCacheOnce(b.required)).toMatchObject({ state: 'cleared' });
    expect(b.fs.renamed).toHaveLength(1);
  });

  it('T-1.5 held elsewhere ⇒ untouched', async () => {
    for (const record of [holder('other', [NAME]), holder('other', [], [NAME])]) {
      const w = bootRequired({ holders: { state: 'ok', value: [record] } });
      expect(await clearPartitionCacheOnce(w.required)).toEqual({ state: 'pending', reason: 'held' });
      expect(w.fs.renamed).toEqual([]);
      expect(w.writes).toEqual([`target:${NAME}`]);
    }
    const unknown = bootRequired({ holders: { state: 'unknown', reason: 'unreadable' } });
    expect(await clearPartitionCacheOnce(unknown.required)).toEqual({ state: 'pending', reason: 'holders-unknown' });
    expect(unknown.fs.renamed).toEqual([]);
  });

  it('unknown evidence or size is a no-op that stays pending, below threshold is verified done', async () => {
    const noEvidence = bootRequired({ evidence: { ...GO, clearOps: { ...GO.clearOps, clearCache: 'unknown' } } });
    expect(await clearPartitionCacheOnce(noEvidence.required)).toEqual({ state: 'skipped', reason: 'evidence-unknown' });
    expect(await noEvidence.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'absent' });
    const unmeasured = bootRequired({ bytes: { state: 'unknown', reason: 'walk cap' } });
    expect(await clearPartitionCacheOnce(unmeasured.required)).toEqual({ state: 'pending', reason: 'unmeasured' });
    expect(unmeasured.fs.renamed).toEqual([]);
    const small = bootRequired({ bytes: { state: 'measured', bytes: 32 * MiB } });
    expect(await clearPartitionCacheOnce(small.required)).toEqual({ state: 'below-threshold', mode: 'one-time', bytes: 32 * MiB });
    expect(await small.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'done', capBytes: 32 * MiB });
    expect(await clearPartitionCacheOnce({ ...small.required, capBytes: 16 * MiB })).toMatchObject({ state: 'cleared' });
  });

  it('NO-GO cap with GO clear evidence enforces periodically at ×2 and never latches', async () => {
    const evidence: PackagedEvidence = { ...GO, cap: 'no-go' };
    const under = bootRequired({ evidence, bytes: { state: 'measured', bytes: 64 * MiB } });
    expect(await clearPartitionCacheOnce(under.required)).toEqual({ state: 'below-threshold', mode: 'periodic', bytes: 64 * MiB });
    const over = bootRequired({ evidence, bytes: { state: 'measured', bytes: 65 * MiB } });
    expect(await clearPartitionCacheOnce(over.required)).toMatchObject({ state: 'cleared', mode: 'periodic' });
    expect(await clearPartitionCacheOnce(over.required)).toMatchObject({ state: 'cleared', mode: 'periodic' });
    expect(await over.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'absent' });
  });
});

describe('clearPartitionCacheOnce at open', () => {
  function openRequired(clearCache: () => Promise<void>) {
    const mem = new MemoryFs();
    const marker = markerOn(mem, '/profile');
    let wake: () => void = () => {};
    const clock = { sleep: () => new Promise<void>(resolve => { wake = resolve; }) };
    return {
      marker, fire: () => wake(),
      required: {
        partition: { name: NAME, dir: `${ROOT}/${NAME}` }, interlock: { phase: 'open' as const, session: { clearCache }, clock },
        fs: cacheFs(), marker, measure: async () => ({ state: 'measured' as const, bytes: 100 * MiB }), evidence: GO, capBytes: 32 * MiB,
      },
    };
  }

  it('marks done only after clearCache resolves; a timeout is not success and settlement is reported apart', async () => {
    const ok = openRequired(async () => {});
    expect(await clearPartitionCacheOnce(ok.required)).toMatchObject({ state: 'cleared', mode: 'one-time' });
    expect(await ok.marker.readCacheClear({ partition: NAME })).toEqual({ state: 'done', capBytes: 32 * MiB });

    const failing = openRequired(async () => { throw new Error('nope'); });
    expect(await clearPartitionCacheOnce(failing.required)).toEqual({ state: 'pending', reason: 'failed' });

    let finish: () => void = () => {};
    const slow = openRequired(() => new Promise<void>(resolve => { finish = resolve; }));
    const run = clearPartitionCacheOnce(slow.required);
    await new Promise(resolve => setImmediate(resolve));
    slow.fire();
    const result = await run;
    expect(result).toMatchObject({ state: 'pending', reason: 'timeout' });
    expect(await slow.marker.readCacheClear({ partition: NAME })).toMatchObject({ state: 'pending', lastReason: 'timeout' });
    finish();
    expect(await (result as { settlement: Promise<unknown> }).settlement).toEqual({ state: 'resolved' });
    expect(await slow.marker.readCacheClear({ partition: NAME })).toMatchObject({ state: 'pending' });
  });
});

describe('real profile folder', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  async function tree(root: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const walk = async (d: string) => {
      for (const entry of await readdir(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.set(path.relative(root, full), createHash('sha256').update(await readFile(full)).digest('hex'));
      }
    };
    await walk(root);
    return out;
  }
  async function size(target: string): Promise<SizeRead> {
    try {
      let bytes = 0;
      for (const entry of await readdir(target, { withFileTypes: true, recursive: true })) {
        if (entry.isFile()) bytes += (await stat(path.join(entry.parentPath, entry.name))).size;
      }
      return { state: 'measured', bytes };
    } catch (error) { return { state: 'unknown', reason: String(error) }; }
  }

  it('T-1.6 Cookies, Local Storage, IndexedDB files byte-identical after the pass', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cache-maint-'));
    const part = path.join(dir, 'Partitions', NAME);
    const files: Record<string, Buffer | string> = {
      'Cookies': 'cookie-db', 'Cookies-journal': 'j',
      'Local Storage/leveldb/000003.log': 'ls-entry', 'IndexedDB/https_example_0.indexeddb.leveldb/CURRENT': 'idb',
      'Cache/Cache_Data/data_1': Buffer.alloc(4096, 7), 'Cache/Cache_Data/index': 'idx',
    };
    for (const [rel, data] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(part, rel)), { recursive: true });
      await writeFile(path.join(part, rel), data);
    }
    const before = await tree(part);
    const realFs = {
      mkdir: async ({ path: d }: { path: string }) => { await mkdir(d, { recursive: true }); },
      rename: async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => { await rename(oldPath, newPath); },
    };
    const w = bootRequired();
    const result = await clearPartitionCacheOnce({
      ...w.required, partition: { name: NAME, dir: part }, fs: realFs, capBytes: 1024, measure: ({ path: p }) => size(p),
    });
    expect(result).toMatchObject({ state: 'cleared' });
    const after = await tree(part);
    const kept = [...before.keys()].filter(rel => !rel.startsWith('Cache/'));
    expect(kept).toHaveLength(4);
    for (const rel of kept) expect(after.get(rel)).toBe(before.get(rel));
    expect([...after.keys()].filter(rel => rel.startsWith('Cache/'))).toEqual([]);
    expect(await readdir(path.join(dir, 'Partitions', '.removing'))).toEqual([`${NAME}.Cache.ab12`]);
  });
});

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCodeCacheOnUpdate, createMaintenanceMarker, createPartitionInterlock, maybeClearCodeCacheAtOpen } from '../index.js';
import type { HolderRecord, PackagedEvidence, PartitionWriterContext, StrictRead } from '../index.js';
import { FakeClock, FakeScheduler, MemoryFs, MemoryLock, MESSAGES } from './fakes.js';

const A = 'site-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'site-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ROOT = '/profile/session/Partitions';
const MiB = 2 ** 20;
const GO: PackagedEvidence = { cap: 'go', clearOps: { clearCache: 'go', clearCodeCaches: 'go' } };
const isManaged = (name: string) => /^site-[0-9a-f]{32}$/.test(name);
const holder = (held: string[]): HolderRecord => ({ v: 1, pid: 9, token: 'other', bootId: 'b', hostname: 'h', profile: '/profile', startedAt: 0, seq: 1, intents: [], held });

/** A partitions root with directory renames; `fail` maps a source path to errno codes its next renames throw. */
function rootFs(names: string[]) {
  const dirs = new Set([ROOT, ...names.map(n => `${ROOT}/${n}`)]);
  const fail = new Map<string, string[]>();
  const renamed: string[] = [];
  return {
    fail, renamed,
    readdir: async () => [...dirs].filter(d => path.dirname(d) === ROOT).map(d => path.basename(d)),
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    realpath: async ({ path: p }: { path: string }) => p,
    mkdir: async () => {},
    rename: async ({ oldPath }: { oldPath: string; newPath: string }) => {
      const code = fail.get(oldPath)?.shift();
      if (code) throw Object.assign(new Error(code), { code });
      renamed.push(oldPath);
    },
  };
}

function setup(names: string[], over: { holders?: StrictRead<HolderRecord[]>; root?: string; fs?: ReturnType<typeof rootFs> | Record<string, unknown> } = {}) {
  const mem = new MemoryFs();
  mem.mkdirSync({ path: '/profile' });
  const store = createMaintenanceMarker({ file: '/profile/maintenance.json', fs: mem });
  const order: string[] = [];
  const marker = {
    readCodeCache: () => store.readCodeCache(),
    writeCodeCachePending: async (input: { forVersion: string; pending: string[] }) => { order.push('pending'); await store.writeCodeCachePending(input); },
    writeLaunchVersion: async (input: { version: string }) => { order.push('version'); await store.writeLaunchVersion(input); },
    settleCodeCache: (input: { partition: string }) => store.settleCodeCache(input),
  };
  const ctx: PartitionWriterContext = {
    assertHeld: async () => {}, setTarget: async () => {},
    readClaims: async () => ({ state: 'unknown', reasons: ['unused'] }),
    resolveRoot: async () => ({ state: 'ok', root: over.root ?? ROOT }),
  };
  const fs = over.fs ?? rootFs(names);
  const interlock = {
    withPartitionWriter: async <T>({ run }: { run: (c: PartitionWriterContext) => Promise<T> }) => ({ state: 'ran' as const, value: await run(ctx) }),
    readHoldersStrict: async () => over.holders ?? { state: 'ok' as const, value: [] },
    isManaged, newToken: () => 'cd34',
  };
  return { fs: fs as ReturnType<typeof rootFs>, store, order, required: { interlock, fs: fs as ReturnType<typeof rootFs>, marker, evidence: GO, version: '2.0.0', isUpdate: true } };
}

describe('clearCodeCacheOnUpdate', () => {
  it('T-3.1 update launch clears code cache of unheld partitions', async () => {
    const w = setup([A, B]);
    expect(await clearCodeCacheOnUpdate(w.required)).toMatchObject({ state: 'ran', cleared: [A, B], kept: [] });
    expect(w.fs.renamed).toEqual([`${ROOT}/${A}/Code Cache`, `${ROOT}/${B}/Code Cache`]);
    expect(w.order).toEqual(['pending', 'version']);
    expect(await w.store.readCodeCache()).toEqual({ state: 'ok', lastLaunchVersion: '2.0.0', forVersion: '2.0.0', pending: [] });
    // A version change without the update flag is an update launch too; the same version is not.
    const same = await clearCodeCacheOnUpdate({ ...w.required, isUpdate: false });
    expect(same).toMatchObject({ state: 'ran', cleared: [] });
    expect(await clearCodeCacheOnUpdate({ ...w.required, isUpdate: false, version: '2.1.0' })).toMatchObject({ cleared: [A, B] });
  });

  it('T-3.2 held partition untouched', async () => {
    const w = setup([A, B], { holders: { state: 'ok', value: [holder([A])] } });
    expect(await clearCodeCacheOnUpdate(w.required)).toMatchObject({ cleared: [B], kept: [{ partition: A, reason: 'held' }] });
    expect(w.fs.renamed).toEqual([`${ROOT}/${B}/Code Cache`]);
    expect(await w.store.readCodeCache()).toMatchObject({ pending: [A] });
    const unknown = setup([A], { holders: { state: 'unknown', reason: 'unreadable' } });
    expect(await clearCodeCacheOnUpdate(unknown.required)).toMatchObject({ cleared: [], kept: [{ partition: A, reason: 'holders-unknown' }] });
    expect(unknown.fs.renamed).toEqual([]);
  });

  it('T-3.4 busy code cache retried next start', async () => {
    const w = setup([A]);
    w.fs.fail.set(`${ROOT}/${A}/Code Cache`, ['EBUSY']);
    expect(await clearCodeCacheOnUpdate(w.required)).toMatchObject({ cleared: [], kept: [{ partition: A, reason: 'busy' }] });
    expect(await w.store.readCodeCache()).toMatchObject({ lastLaunchVersion: '2.0.0', pending: [A] });
    expect(await clearCodeCacheOnUpdate({ ...w.required, isUpdate: false })).toMatchObject({ cleared: [A], kept: [] });
    expect(await w.store.readCodeCache()).toMatchObject({ pending: [] });
  });

  it('records pending without mutating when clear evidence is not GO', async () => {
    const w = setup([A]);
    const result = await clearCodeCacheOnUpdate({ ...w.required, evidence: { ...GO, clearOps: { ...GO.clearOps, clearCodeCaches: 'unknown' } } });
    expect(result).toEqual({ state: 'skipped', reason: 'evidence-unknown' });
    expect(w.fs.renamed).toEqual([]);
    expect(await w.store.readCodeCache()).toMatchObject({ pending: [A], lastLaunchVersion: '2.0.0' });
  });
});

describe('real profile folder', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  async function hashes(root: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const e of await readdir(root, { withFileTypes: true, recursive: true })) {
      const full = path.join(e.parentPath, e.name);
      if (e.isFile()) out.set(path.relative(root, full), createHash('sha256').update(await readFile(full)).digest('hex'));
    }
    return out;
  }

  it('T-3.5 storage untouched', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'code-cache-'));
    const root = path.join(dir, 'Partitions'), part = path.join(root, A);
    const files = ['Cookies', 'Local Storage/leveldb/000003.log', 'IndexedDB/https_example_0.indexeddb.leveldb/CURRENT', 'Code Cache/js/index', 'Code Cache/wasm/index'];
    for (const rel of files) { await mkdir(path.dirname(path.join(part, rel)), { recursive: true }); await writeFile(path.join(part, rel), `data:${rel}`); }
    const before = await hashes(part);
    const fs = {
      readdir: ({ path: p }: { path: string }) => readdir(p),
      lstat: ({ path: p }: { path: string }) => lstat(p),
      realpath: ({ path: p }: { path: string }) => realpath(p),
      mkdir: async ({ path: p }: { path: string }) => { await mkdir(p, { recursive: true }); },
      rename: ({ oldPath, newPath }: { oldPath: string; newPath: string }) => rename(oldPath, newPath),
    };
    const w = setup([A], { root, fs });
    expect(await clearCodeCacheOnUpdate(w.required)).toMatchObject({ cleared: [A] });
    const after = await hashes(part);
    expect([...after.keys()].sort()).toEqual(['Cookies', 'IndexedDB/https_example_0.indexeddb.leveldb/CURRENT', 'Local Storage/leveldb/000003.log']);
    for (const [rel, hash] of after) expect(hash).toBe(before.get(rel));
    expect(await readdir(path.join(root, '.removing'))).toEqual([`${A}.Code Cache.cd34`]);
  });
});

describe('maybeClearCodeCacheAtOpen through acquireSiteSession', () => {
  function site(bytes: number) {
    const clock = new FakeClock(), scheduler = new FakeScheduler(clock), fs = new MemoryFs();
    const events: string[] = [];
    const settled: string[] = [];
    let interlock: ReturnType<typeof createPartitionInterlock<{ partition: string }>>;
    const session = { clearCodeCaches: async () => {
      events.push('clearCodeCaches');
      try { interlock.siteSession({ partition: `persist:${A}` }); events.push('usable-during-clear'); } catch { events.push('not-yet-usable'); }
    } };
    interlock = createPartitionInterlock<{ partition: string }>({
      paths: { interlockDir: '/profile/partition-interlock', sessionDataDir: '/profile/session' },
      fs, lock: new MemoryLock(clock, scheduler), clock, scheduler,
      process: { pid: 100, bootId: 'b', hostname: 'h', isAlive: () => true, newToken: () => '64ab' },
      fromPartition: ({ partition }) => ({ partition }), isManaged,
      claimSources: { partitions: [], instances: [] },
      invalidateRetirement: async () => {},
      openMaintenance: async ({ partition }) => {
        const result = await maybeClearCodeCacheAtOpen({
          session, evidence: GO, clock: scheduler,
          measure: async () => ({ state: 'measured', bytes }),
          marker: { settle: async () => { settled.push(partition); } },
        });
        events.push(`maintenance:${result.state}`);
      },
      messages: MESSAGES, log: () => {},
    });
    expect(interlock.registerHolder()).toEqual({ state: 'registered' });
    return { interlock, events, settled };
  }

  it('T-3.3 > 64 MB cleared at open', async () => {
    const big = site(64 * MiB + 1);
    expect(await big.interlock.acquireSiteSession({ partition: `persist:${A}`, subjectDir: '/sites/a' })).toMatchObject({ maintenance: 'ran' });
    expect(big.events).toEqual(['clearCodeCaches', 'not-yet-usable', 'maintenance:cleared']);
    expect(big.settled).toEqual([A]);
    expect(big.interlock.siteSession({ partition: `persist:${A}` })).toEqual({ partition: `persist:${A}` });
    const small = site(64 * MiB);
    await small.interlock.acquireSiteSession({ partition: `persist:${A}`, subjectDir: '/sites/a' });
    expect(small.events).toEqual(['maintenance:below-threshold']);
    expect(small.settled).toEqual([]);
  });

  it('T-3.6 second window of a held site does not clear', async () => {
    const s = site(200 * MiB);
    await s.interlock.acquireSiteSession({ partition: `persist:${A}`, subjectDir: '/sites/a' });
    expect(await s.interlock.acquireSiteSession({ partition: `persist:${A}`, subjectDir: '/sites/a' })).toMatchObject({ maintenance: 'already-held' });
    expect(s.events.filter(e => e === 'clearCodeCaches')).toHaveLength(1);
  });

  it('busy, failure or timeout does not mark success; unmeasured or non-GO does nothing', async () => {
    const measure = async () => ({ state: 'measured' as const, bytes: 100 * MiB });
    const settled: string[] = [];
    const marker = { settle: async () => { settled.push('x'); } };
    const never = { sleep: () => new Promise<void>(() => {}) };
    const failed = await maybeClearCodeCacheAtOpen({ session: { clearCodeCaches: async () => { throw new Error('busy'); } }, measure, evidence: GO, marker, clock: never });
    expect(failed).toEqual({ state: 'pending', reason: 'failed' });
    let finish: () => void = () => {};
    const timedOut = await maybeClearCodeCacheAtOpen({
      session: { clearCodeCaches: () => new Promise<void>(resolve => { finish = resolve; }) }, measure, evidence: GO, marker, clock: { sleep: async () => {} },
    });
    expect(timedOut).toMatchObject({ state: 'pending', reason: 'timeout' });
    finish();
    expect(await (timedOut as { settlement: Promise<unknown> }).settlement).toEqual({ state: 'resolved' });
    const calls: string[] = [];
    const session = { clearCodeCaches: async () => { calls.push('clear'); } };
    expect(await maybeClearCodeCacheAtOpen({ session, measure: async () => ({ state: 'unknown', reason: 'cap' }), evidence: GO, marker, clock: never }))
      .toEqual({ state: 'skipped', reason: 'unmeasured' });
    expect(await maybeClearCodeCacheAtOpen({ session, measure, evidence: { ...GO, clearOps: { ...GO.clearOps, clearCodeCaches: 'no-go' } }, marker, clock: never }))
      .toEqual({ state: 'skipped', reason: 'evidence-no-go' });
    expect(calls).toEqual([]);
    expect(settled).toEqual([]);
  });
});

/** ST-2a.J partition interlock: holders, fence, writer lock, strict readers. No Electron is loaded. */
import { describe, expect, it } from 'vitest';
import {
  createPartitionInterlock, listCandidates, PartitionBusyError, PartitionNotHeldError,
  PartitionOpenRefusedError, presenceClaimSource, resolvePartitionRoot,
} from '../index.js';
import type { PartitionClaimSource, PartitionInterlock } from '../index.js';
import type { PartitionInterlockLogEvent, PartitionInterlockRequired } from '../profile-interlock.js';
import { readPresenceStrict } from '../../updates/index.js';
import { FakeClock, FakeScheduler, MemoryFs, MemoryLock, MESSAGES } from './fakes.js';

const P = 'persist:site-0123456789abcdef0123456789abcdef';
const DIR = 'site-0123456789abcdef0123456789abcdef';
const isManaged = (name: string) => /^site-[0-9a-f]{32}$/.test(name);

interface World { fs: MemoryFs; clock: FakeClock; scheduler: FakeScheduler; lock: MemoryLock; alive: Set<number> }
function world(): World {
  const clock = new FakeClock(), scheduler = new FakeScheduler(clock);
  return { fs: new MemoryFs(), clock, scheduler, lock: new MemoryLock(clock, scheduler), alive: new Set() };
}

interface ProcOptions {
  pid?: number; profile?: string; sources?: PartitionClaimSource[]; presenceDir?: string; maintenance?: string[];
  invalidateRetirement?: PartitionInterlockRequired<{ partition: string }>['invalidateRetirement'];
  openMaintenance?: PartitionInterlockRequired<{ partition: string }>['openMaintenance'];
}
function proc(w: World, options: ProcOptions = {}) {
  const pid = options.pid ?? 100, profile = options.profile ?? '/profile';
  w.alive.add(pid);
  const logs: PartitionInterlockLogEvent[] = [];
  const invalidated: string[] = [];
  const instances = options.presenceDir === undefined ? [] : [presenceClaimSource({
    directory: options.presenceDir, fs: presenceFs(w.fs), liveness: ({ pid: p }) => w.alive.has(p),
  })];
  const interlock = createPartitionInterlock({
    paths: { interlockDir: `${profile}/partition-interlock`, sessionDataDir: `${profile}/session` },
    fs: w.fs, lock: w.lock, clock: w.clock, scheduler: w.scheduler,
    process: { pid, bootId: 'boot-1', hostname: 'host', isAlive: ({ pid: p }) => w.alive.has(p), newToken: () => `${pid.toString(16)}ab` },
    fromPartition: ({ partition }) => ({ partition }),
    isManaged,
    claimSources: { partitions: options.sources ?? [], instances },
    invalidateRetirement: options.invalidateRetirement ?? (async ({ partition }) => { invalidated.push(partition); }),
    openMaintenance: options.openMaintenance ?? (async ({ partition }) => { options.maintenance?.push(`${pid}:${partition}`); }),
    messages: MESSAGES,
    log: event => { logs.push(event); },
  });
  return { interlock, logs, invalidated, pid };
}

function presenceFs(fs: MemoryFs) {
  return {
    readdirSync: ({ path }: { path: string }) => {
      if (fs.failReaddir.has(path)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      if (!fs.dirs.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return [...fs.files.keys()].filter(f => f.startsWith(`${path}/`)).map(f => f.slice(path.length + 1));
    },
    readFileSync: ({ path }: { path: string }) => {
      if (fs.failRead.has(path)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      const data = fs.files.get(path);
      if (data === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return data;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const flush = async (rounds = 20) => { for (let i = 0; i < rounds; i += 1) await new Promise<void>(r => setImmediate(r)); };

async function claimsInsidePass(interlock: PartitionInterlock) {
  const result = await interlock.withPartitionWriter({ run: async ({ readClaims }) => readClaims() });
  if (result.state !== 'ran') throw new Error('writer did not run');
  return result.value;
}

describe('acquireSiteSession and siteSession', () => {
  it('refuses an open without a durable intent and omits the failed intent from the next heartbeat', async () => {
    const w = world(), self = proc(w);
    self.interlock.registerHolder();
    const unavailable = Object.assign(new Error('cannot publish intent'), { code: 'ENOSPC' });
    w.fs.gate = async (op, target) => {
      if (op === 'rename' && target === '/profile/partition-interlock/holders/100-64ab.json') throw unavailable;
    };
    await expect(self.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).rejects.toMatchObject({
      name: 'PartitionOpenRefusedError',
      message: 'Cannot write to the settings folder (/profile/partition-interlock).',
      cause: unavailable,
    });
    expect(self.invalidated).toEqual([]);
    expect(() => self.interlock.siteSession({ partition: P })).toThrow(PartitionNotHeldError);

    w.fs.gate = async () => {};
    w.scheduler.tick();
    await flush();
    expect(await self.interlock.readHoldersStrict()).toMatchObject({ state: 'ok', value: [{ pid: 100, seq: 2, intents: [], held: [] }] });
  });

  it('withdraws the published intent and does not open if retirement invalidation fails', async () => {
    const w = world(), state = { calls: [] as unknown[] };
    const cause = new Error('retirement store unavailable');
    const self = proc(w, { invalidateRetirement: async input => { state.calls.push(input); throw cause; } });
    self.interlock.registerHolder();
    await expect(self.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).rejects.toMatchObject({
      name: 'PartitionOpenRefusedError', message: MESSAGES.refused, cause,
    });
    expect(state.calls).toEqual([{ partition: DIR, subjectDir: '/s', reason: 'reacquired' }]);
    expect(await self.interlock.readHoldersStrict()).toMatchObject({ state: 'ok', value: [{ pid: 100, seq: 2, intents: [], held: [] }] });
    expect(() => self.interlock.siteSession({ partition: P })).toThrow(PartitionNotHeldError);
  });

  it('acquires the session but skips maintenance when a sibling holder cannot be read', async () => {
    const w = world(), maintenance: string[] = [];
    const self = proc(w, { maintenance });
    self.interlock.registerHolder();
    const file = '/profile/partition-interlock/holders/9-ab.json';
    w.fs.writeFileSync({ path: file, data: '{}' });
    w.fs.failRead.add(file);

    expect(await self.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' }))
      .toEqual({ state: 'held', partition: DIR, maintenance: 'skipped-unknown-holders' });
    expect(self.interlock.siteSession({ partition: P })).toEqual({ partition: P });
    expect(maintenance).toEqual([]);
    expect(self.logs).toEqual([{ event: 'maintenance-skipped', partition: DIR, detail: 'holder 9-ab.json unreadable (EACCES)' }]);
  });

  it('keeps the session acquired and exposes a maintenance failure', async () => {
    const w = world();
    const self = proc(w, { openMaintenance: async () => { throw Object.assign(new Error('cache is busy'), { code: 'EBUSY' }); } });
    self.interlock.registerHolder();
    expect(await self.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' }))
      .toEqual({ state: 'held', partition: DIR, maintenance: 'failed' });
    expect(self.interlock.siteSession({ partition: P })).toEqual({ partition: P });
    expect(self.logs).toEqual([{ event: 'maintenance-failed', partition: DIR, detail: 'EBUSY' }]);
  });

  it('reports a failed heartbeat, keeps its previous record, and publishes on the next tick', async () => {
    const w = world(), self = proc(w);
    self.interlock.registerHolder();
    const file = '/profile/partition-interlock/holders/100-64ab.json';
    const original = await w.fs.readFile({ path: file });
    w.fs.gate = async (op, target) => {
      if (op === 'rename' && target === file) throw Object.assign(new Error('read-only holder'), { code: 'EROFS' });
    };
    w.scheduler.tick();
    await flush();
    expect(self.logs).toEqual([{ event: 'heartbeat-failed', detail: 'EROFS' }]);
    expect(await w.fs.readFile({ path: file })).toBe(original);

    w.fs.gate = async () => {};
    w.scheduler.tick();
    await flush();
    expect(await self.interlock.readHoldersStrict()).toMatchObject({ state: 'ok', value: [{ pid: 100, seq: 2, intents: [], held: [] }] });
  });

  it('T-2a.1 opening a site waits while a pass holds the lock', async () => {
    const w = world(), writer = proc(w, { pid: 1 }), opener = proc(w, { pid: 2 });
    writer.interlock.registerHolder(); opener.interlock.registerHolder();
    const rename = deferred();
    let opened = false;
    const pass = writer.interlock.withPartitionWriter({ run: async () => { await rename.promise; } });
    await flush();
    const open = opener.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' }).then(r => { opened = true; return r; });
    await flush(40);
    expect(opened).toBe(false);
    expect(() => opener.interlock.siteSession({ partition: P })).toThrow(PartitionNotHeldError);
    rename.resolve();
    await pass;
    await expect(open).resolves.toMatchObject({ state: 'held' });
    expect(opener.interlock.siteSession({ partition: P })).toEqual({ partition: P });
    expect(w.lock.calls[0]).toMatchObject({ staleMs: Number.POSITIVE_INFINITY, timeoutMs: 2000 });
  });

  it('a live writer keeps the fence past abandonMs (logged only) and the open is busy at the cap', async () => {
    const w = world(), writer = proc(w, { pid: 1 }), opener = proc(w, { pid: 2 });
    writer.interlock.registerHolder(); opener.interlock.registerHolder();
    const never = deferred();
    void writer.interlock.withPartitionWriter({ run: async () => { await never.promise; } });
    await flush();
    const open = opener.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' });
    await expect(open).rejects.toBeInstanceOf(PartitionBusyError);
    await expect(open).rejects.toThrow(MESSAGES.busy);
    expect(opener.logs.some(entry => entry.event === 'writer-quiet')).toBe(true);
    expect(w.clock.mono()).toBeGreaterThanOrEqual(30_000);
    never.resolve();
  });

  it('an unreadable writer lock is treated as busy, never as free', async () => {
    const w = world(), opener = proc(w, { pid: 2 });
    opener.interlock.registerHolder();
    w.fs.writeFileSync({ path: '/profile/partition-interlock/target.json', data: JSON.stringify({ v: 1, lockToken: 'x', target: '*', seq: 1 }) });
    w.lock.unknownToken = true;
    await expect(opener.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).rejects.toBeInstanceOf(PartitionBusyError);
  });

  it('a proven-dead writer no longer fences, so a crash cannot block opens forever', async () => {
    const w = world(), opener = proc(w, { pid: 2 });
    opener.interlock.registerHolder();
    w.lock.owners.set('/profile/partition-interlock/writer.lock', 'gone');
    w.fs.writeFileSync({ path: '/profile/partition-interlock/target.json', data: JSON.stringify({ v: 1, lockToken: 'gone', target: '*', seq: 4 }) });
    w.lock.deadOwner = true;
    await expect(opener.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).resolves.toMatchObject({ state: 'held' });
  });

  it('T-2a.2 siteSession throws for an unheld partition', () => {
    const w = world(), p = proc(w);
    p.interlock.registerHolder();
    expect(() => p.interlock.siteSession({ partition: P })).toThrow(PartitionNotHeldError);
    expect(() => p.interlock.assertHeld({ partition: P })).toThrow(PartitionNotHeldError);
    expect(() => p.interlock.assertHeld({ partition: 'persist:other' })).not.toThrow();
  });

  it('unregistered process cannot acquire', async () => {
    const w = world(), never = proc(w, { pid: 3 });
    await expect(never.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).rejects.toThrow(PartitionOpenRefusedError);
    const failed = proc(w, { pid: 4, profile: '/readonly' });
    const write = w.fs.writeFileSync.bind(w.fs);
    w.fs.writeFileSync = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
    expect(failed.interlock.registerHolder()).toMatchObject({ state: 'failed' });
    w.fs.writeFileSync = write;
    const refused = failed.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' });
    await expect(refused).rejects.toThrow(MESSAGES.unregistered({ directory: '/readonly/partition-interlock' }));
    expect(failed.invalidated).toEqual([]);
  });

  it('persists the intent before reading the target, invalidates retirement, then holds sticky', async () => {
    const w = world(), p = proc(w, { pid: 7 });
    p.interlock.registerHolder();
    const order: string[] = [];
    const holderFile = '/profile/partition-interlock/holders/7-7ab.json';
    w.fs.gate = async (op, target) => {
      if (op === 'rename' && target === holderFile) order.push(`publish:${w.fs.files.get(holderFile)?.includes(DIR) ? 'again' : 'intent'}`);
      if (op === 'read' && target.endsWith('target.json')) order.push('read-target');
    };
    await p.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' });
    expect(order.slice(0, 2)).toEqual(['publish:intent', 'read-target']);
    expect(p.invalidated).toEqual([DIR]);
    const record = JSON.parse(w.fs.files.get(holderFile) ?? '{}');
    expect(record).toMatchObject({ held: [DIR], intents: [] });
    await expect(p.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).resolves.toMatchObject({ maintenance: 'already-held' });
  });

  it('step 2.5 skips open maintenance while another holder lists the partition', async () => {
    const w = world(), ran: string[] = [];
    const a = proc(w, { pid: 1, maintenance: ran }), b = proc(w, { pid: 2, maintenance: ran });
    a.interlock.registerHolder(); b.interlock.registerHolder();
    await expect(a.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).resolves.toMatchObject({ maintenance: 'ran' });
    await expect(b.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).resolves.toMatchObject({ maintenance: 'skipped-other-holder' });
    expect(ran).toEqual([`1:${DIR}`]);
  });
});

describe('claims and strict readers', () => {
  it('returns the full live presence record while dropping dead and unrelated entries', () => {
    const w = world();
    const directory = '/profile/presence';
    const live = { pid: 37, startedAt: 14, heartbeatAt: 81 };
    w.fs.mkdirSync({ path: directory });
    w.fs.writeFileSync({ path: `${directory}/37.json`, data: JSON.stringify(live) });
    w.fs.writeFileSync({ path: `${directory}/82.json`, data: JSON.stringify({ pid: 82, startedAt: 36, heartbeatAt: 99 }) });
    w.fs.writeFileSync({ path: `${directory}/readme.txt`, data: 'not a presence record' });
    expect(readPresenceStrict({ directory, fs: presenceFs(w.fs), liveness: ({ pid }) => pid === 37 }))
      .toEqual({ state: 'ok', value: [live] });
  });
  it('T-2a.5 updater-disabled sibling is seen as another instance', async () => {
    const w = world(), self = proc(w, { pid: 1, presenceDir: '/profile/presence' }), sibling = proc(w, { pid: 2 });
    self.interlock.registerHolder(); sibling.interlock.registerHolder();
    const claims = await claimsInsidePass(self.interlock);
    expect(claims).toMatchObject({ state: 'ok', otherInstances: [2] });
  });

  it('T-2a.6 unreadable presence = skip', async () => {
    const w = world(), self = proc(w, { pid: 1, presenceDir: '/profile/presence' });
    self.interlock.registerHolder();
    w.fs.mkdirSync({ path: '/profile/presence' });
    w.fs.writeFileSync({ path: '/profile/presence/9.json', data: '{}' });
    w.fs.failRead.add('/profile/presence/9.json');
    expect(await claimsInsidePass(self.interlock)).toMatchObject({ state: 'unknown' });
    w.fs.failRead.clear(); w.fs.files.delete('/profile/presence/9.json');
    w.fs.failReaddir.add('/profile/presence');
    expect(await claimsInsidePass(self.interlock)).toMatchObject({ state: 'unknown' });
  });

  it('T-2a.7 corrupt presence record = skip', async () => {
    const w = world(), self = proc(w, { pid: 1, presenceDir: '/profile/presence' });
    self.interlock.registerHolder();
    w.fs.mkdirSync({ path: '/profile/presence' });
    w.fs.writeFileSync({ path: '/profile/presence/7.json', data: JSON.stringify({ pid: 'x' }) });
    expect(await claimsInsidePass(self.interlock)).toMatchObject({ state: 'unknown' });
    const direct = readPresenceStrict({ directory: '/profile/presence', fs: presenceFs(w.fs), liveness: () => true });
    expect(direct.state).toBe('unknown');
    expect(readPresenceStrict({ directory: '/absent', fs: presenceFs(w.fs), liveness: () => true })).toEqual({ state: 'ok', value: [] });
  });

  it('a corrupt holder record or failing claim source is unknown, never empty', async () => {
    const w = world(), self = proc(w, { pid: 1, sources: [{ name: 'tracked', read: async () => ({ state: 'unknown', reason: 'damaged' }) }] });
    self.interlock.registerHolder();
    expect(await claimsInsidePass(self.interlock)).toMatchObject({ state: 'unknown', reasons: ['tracked: damaged'] });
    const other = proc(w, { pid: 5, profile: '/p2' });
    other.interlock.registerHolder();
    w.fs.writeFileSync({ path: '/p2/partition-interlock/holders/9-ab.json', data: '{"v":1' });
    expect(await other.interlock.readHoldersStrict()).toMatchObject({ state: 'unknown' });
  });

  it('dead holders are excluded; live claims and sources are unioned', async () => {
    const w = world(), self = proc(w, { pid: 1, sources: [{ name: 'tracked', read: async () => ({ state: 'ok', value: ['site-a'] }) }] });
    const dead = proc(w, { pid: 2 });
    self.interlock.registerHolder(); dead.interlock.registerHolder();
    await dead.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' });
    w.alive.delete(2);
    expect(await claimsInsidePass(self.interlock)).toEqual({ state: 'ok', claimed: ['site-a'], otherInstances: [] });
  });

  it('T-2a.11 second profile is separate', async () => {
    const w = world(), a = proc(w, { pid: 1, profile: '/a' }), b = proc(w, { pid: 2, profile: '/b' });
    a.interlock.registerHolder(); b.interlock.registerHolder();
    const never = deferred();
    void a.interlock.withPartitionWriter({ run: async () => { await never.promise; } });
    await flush();
    await expect(b.interlock.acquireSiteSession({ partition: P, subjectDir: '/s' })).resolves.toMatchObject({ state: 'held' });
    expect(await b.interlock.readHoldersStrict()).toMatchObject({ state: 'ok', value: [{ pid: 2 }] });
    never.resolve();
  });

  it('T-2a.12 a second writer cannot enter while the first awaits a rename', async () => {
    const w = world(), a = proc(w, { pid: 1 }), b = proc(w, { pid: 2 });
    a.interlock.registerHolder(); b.interlock.registerHolder();
    const rename = deferred();
    let inside = 0, overlap = false;
    const body = async () => { inside += 1; if (inside > 1) overlap = true; await rename.promise; inside -= 1; };
    const first = a.interlock.withPartitionWriter({ run: body });
    await flush();
    const second = await b.interlock.withPartitionWriter({ run: body });
    expect(second).toEqual({ state: 'skipped', reason: 'writer-busy' });
    expect(overlap).toBe(false);
    rename.resolve();
    await expect(first).resolves.toMatchObject({ state: 'ran' });
  });
});

describe('partition root', () => {
  function rootFs() {
    const w = world();
    for (const dir of ['/s/Partitions', `/s/Partitions/${DIR}`, '/elsewhere/real']) w.fs.mkdirSync({ path: dir });
    return w.fs;
  }
  it('resolves the root and reports absence separately from failure', async () => {
    const fs = rootFs();
    expect(await resolvePartitionRoot({ sessionDataDir: '/s', fs })).toEqual({ state: 'ok', root: '/s/Partitions' });
    expect(await resolvePartitionRoot({ sessionDataDir: '/none', fs })).toEqual({ state: 'absent' });
  });
  it('reports an unreadable partitions root rather than returning an empty list', async () => {
    const fs = rootFs();
    fs.failReaddir.add('/s/Partitions');
    expect(await listCandidates({ root: '/s/Partitions', fs, isManaged }))
      .toEqual({ state: 'unknown', reason: 'partitions root unreadable (EACCES)' });
  });
  it('T-2a.9 a symlinked candidate is skipped', async () => {
    const fs = rootFs(), link = `/s/Partitions/site-${'f'.repeat(32)}`;
    fs.links.set(link, '/elsewhere/real');
    const listed = await listCandidates({ root: '/s/Partitions', fs, isManaged });
    expect(listed).toMatchObject({ state: 'ok', candidates: [{ name: DIR }], skipped: [{ name: `site-${'f'.repeat(32)}`, reason: 'link' }] });
  });
  it('T-2a.10 junction/realpath escape is skipped', async () => {
    const fs = rootFs(), name = `site-${'e'.repeat(32)}`;
    fs.mkdirSync({ path: `/s/Partitions/${name}` });
    const realpath = fs.realpath.bind(fs);
    // A Windows junction reports as a plain directory to lstat but resolves elsewhere.
    fs.realpath = async ({ path }) => (path.endsWith(name) ? '/elsewhere/real' : realpath({ path }));
    const listed = await listCandidates({ root: '/s/Partitions', fs, isManaged });
    expect(listed).toMatchObject({ state: 'ok', candidates: [{ name: DIR }], skipped: [{ name, reason: 'escape' }] });
  });
});

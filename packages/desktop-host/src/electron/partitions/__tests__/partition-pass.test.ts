/** ST-2c.J partition pass and owner-confirmed sign-in removal over in-memory ports. No Electron is loaded. */
import { describe, expect, it } from 'vitest';
import { createPartitionInterlock, createRetirementLedger, listAmbiguousPartitions, listCandidates, removeAmbiguousPartition, runPartitionPass } from '../index.js';
import type { PartitionPassReport, RetirementRecord } from '../index.js';
import { FakeClock, FakeScheduler, MemoryLock, MESSAGES } from './fakes.js';
import { MemoryDurableJson, PassFs } from './pass-fakes.js';

const PROFILE = '/profile';
const ROOT = '/profile/session/Partitions';
const ASIDE = `${ROOT}/.removing`;
const A = `site-${'a'.repeat(32)}`;
const B = `site-${'b'.repeat(32)}`;
const isManaged = (name: string) => /^site-[0-9a-f]{32}$/.test(name);
const never = { sleep: () => new Promise<void>(() => {}) };
const ticks = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise<void>(r => setImmediate(r)); };

function world() {
  const clock = new FakeClock(), scheduler = new FakeScheduler(clock), fs = new PassFs();
  const store = new MemoryDurableJson();
  store.frozen = () => fs.frozen;
  let n = 0, tok = 0;
  const ledger = createRetirementLedger({ profile: PROFILE, durableJson: store, clock, id: () => `r${++n}` });
  fs.tree(ROOT); fs.tree('/sites');
  const w = {
    clock, scheduler, fs, store, ledger, alive: new Set<number>(), tracked: { names: [] as string[], unknown: false },
    lock: new MemoryLock(clock, scheduler), maintained: [] as string[], token: () => `${(++tok).toString(16)}f`,
  };
  return w;
}
type World = ReturnType<typeof world>;

function proc(w: World, pid: number, { invalidates = true } = {}) {
  w.alive.add(pid);
  const interlock = createPartitionInterlock({
    paths: { interlockDir: `${PROFILE}/partition-interlock`, sessionDataDir: `${PROFILE}/session` },
    fs: w.fs, lock: w.lock, clock: w.clock, scheduler: w.scheduler,
    process: { pid, bootId: 'boot-1', hostname: 'host', isAlive: ({ pid: p }) => w.alive.has(p), newToken: () => `${pid.toString(16)}ab` },
    fromPartition: ({ partition }) => ({ partition }), isManaged,
    claimSources: { partitions: [{ name: 'tracked', read: async () => (w.tracked.unknown
      ? { state: 'unknown' as const, reason: 'damaged' } : { state: 'ok' as const, value: [...w.tracked.names] }) }], instances: [] },
    invalidateRetirement: async ({ partition }) => { if (invalidates) w.ledger.invalidate({ partition, reason: 'reacquired' }, {}); },
    openMaintenance: async () => {}, messages: MESSAGES, log: () => {},
  });
  interlock.registerHolder();
  return interlock;
}
function retire(w: World, name = A): RetirementRecord {
  w.fs.tree(`${ROOT}/${name}`, { Cookies: 'jar', 'Cache/x': 'c' });
  return w.ledger.append({ candidate: {
    basis: 'erased', profile: PROFILE, sessionRoot: ROOT, partition: name, subjectId: 's1', subjectDir: `/sites/${name}`,
    dirIdentity: { dev: 1, ino: 5, birthtimeMs: 9 }, parentDir: '/sites', parentDev: 1, eraseVersion: '1.0.0', erasedAt: '2026-11-01T00:00:00.000Z',
  } }, {});
}

async function pass(w: World, interlock: ReturnType<typeof proc>, scheduler: { sleep(r: { ms: number }): Promise<void> } = never): Promise<PartitionPassReport> {
  const reports: PartitionPassReport[] = [];
  const out = await runPartitionPass({
    interlock, ledger: w.ledger, fs: w.fs, root: { isManaged }, scheduler, newToken: w.token,
    maintenance: async ({ partition, classification }) => { w.maintained.push(`${classification}:${partition}`); },
    report: ({ report }) => { reports.push(report); },
  });
  const report = out.state === 'finished' ? out.report : await out.done;
  expect(reports).toEqual([report]);
  return report;
}
const record = (w: World) => { const r = w.ledger.readStrict({}, {}); return r.state === 'ok' ? r.records : []; };
const exists = (w: World, p: string) => w.fs.dirs.has(p);
const onAsideRename = (w: World, run: () => Promise<void> | void) => {
  let fired = false;
  w.fs.gate = async (op, target) => { if (!fired && op === 'rename' && target.startsWith(`${ASIDE}/${A}.`)) { fired = true; await run(); } };
};

describe('partition pass', () => {
  it('T-2c.1 retired partition removed only when all four checks pass', async () => {
    const scenarios: Array<[string, (w: World, self: ReturnType<typeof proc>) => Promise<void> | void]> = [
      ['other-instance', w => { proc(w, 200); }],
      ['tracked', w => { w.tracked.names = [A]; }],
      ['absence-uncertain', w => { w.fs.devs.set('/sites', 9); }],
      ['held', async (_w, self) => { await self.acquireSiteSession({ partition: `persist:${A}`, subjectDir: `/sites/${A}` }); }],
    ];
    for (const [reason, setup] of scenarios) {
      const w = world(), self = proc(w, 100, { invalidates: false });
      retire(w);
      await setup(w, self);
      const report = await pass(w, self);
      expect(report.kept).toContainEqual({ partition: A, reason });
      expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
      expect(record(w)[0]).toMatchObject({ state: 'pending', lastReason: reason });
    }
    const w = world();
    retire(w);
    const report = await pass(w, proc(w, 100));
    expect(report).toMatchObject({ result: 'done', removed: [A] });
    expect(exists(w, `${ROOT}/${A}`)).toBe(false);
    expect(await w.fs.readdir({ path: ASIDE })).toEqual([]);
    expect(record(w)[0]).toMatchObject({ state: 'removed' });
  });

  it('T-2c.2 sibling starting during a sweep keeps its partition', async () => {
    const w = world(), self = proc(w, 100);
    retire(w);
    let acquired: Promise<unknown> = Promise.resolve();
    onAsideRename(w, async () => {
      acquired = proc(w, 200).acquireSiteSession({ partition: `persist:${A}`, subjectDir: `/sites/${A}` });
      await ticks();
    });
    const report = await pass(w, self);
    expect(report.removed).toEqual([]);
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    await expect(acquired).resolves.toMatchObject({ state: 'held' });
  });

  it('T-2c.3 add/open during discovery keeps the partition', async () => {
    const w = world(), self = proc(w, 100);
    retire(w);
    onAsideRename(w, () => { w.tracked.names = [A]; });
    const report = await pass(w, self);
    expect(report.removed).toEqual([]);
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(record(w)[0]).toMatchObject({ state: 'pending', lastReason: 'tracked' });
    expect(await w.fs.readdir({ path: ASIDE })).toEqual([]);
  });

  it('T-2c.4 same path re-created → partition kept and record invalidated', async () => {
    const w = world();
    retire(w);
    w.fs.tree(`/sites/${A}`);
    const report = await pass(w, proc(w, 100));
    expect(report.kept).toContainEqual({ partition: A, reason: 'site-exists' });
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(record(w)[0]).toMatchObject({ state: 'invalidated', lastReason: 'site-exists' });
  });

  it('T-2c.5 later occupant of the same path never inherits an actionable record', async () => {
    const w = world(), self = proc(w, 100);
    retire(w);
    w.fs.tree(`/sites/${A}`);
    await pass(w, self);
    await w.fs.rm({ path: `/sites/${A}` });
    const report = await pass(w, self);
    expect(report.removed).toEqual([]);
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(record(w).map(r => r.state)).toEqual(['invalidated']);
    expect(w.ledger.transition({ id: 'r1', from: 'invalidated', to: 'pending' }, {})).toMatchObject({ state: 'illegal' });
  });

  it('T-2c.6 ambiguous partition keeps Cookies', async () => {
    const w = world();
    const keep = { Cookies: 'jar', 'Local Storage/leveldb/1': 'ls', 'IndexedDB/x/1': 'idb', 'Service Worker/s': 'sw' };
    w.fs.tree(`${ROOT}/${B}`, { ...keep, 'Cache/data': 'c', 'Code Cache/js/1': 'cc' });
    const report = await pass(w, proc(w, 100));
    expect(report.cacheCleared).toEqual([B]);
    for (const [name, data] of Object.entries(keep)) expect(w.fs.files.get(`${ROOT}/${B}/${name}`)).toBe(data);
    expect(exists(w, `${ROOT}/${B}/Cache`) || exists(w, `${ROOT}/${B}/Code Cache`)).toBe(false);
    expect(await w.fs.readdir({ path: ASIDE })).toEqual([]);
    expect(w.maintained).toEqual([`ambiguous:${B}`]);
  });

  it('T-2c.7 damaged tracked list ⇒ pass skipped', async () => {
    const w = world();
    retire(w);
    w.fs.tree(`${ROOT}/${B}`, { Cookies: 'jar', 'Cache/data': 'c' });
    w.tracked.unknown = true;
    const report = await pass(w, proc(w, 100));
    expect(report).toMatchObject({ result: 'skipped', reason: 'unknown-claims', removed: [], cacheCleared: [] });
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(w.fs.files.get(`${ROOT}/${B}/Cache/data`)).toBe('c');
    expect(record(w)[0]).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('T-2c.8 crash after rename before commit restores the partition next start', async () => {
    const w = world();
    retire(w);
    let armed = false;
    w.fs.fault = (op, target) => {
      if (armed) { w.fs.frozen = true; return 'EIO'; }
      if (op === 'rename' && target.startsWith(`${ASIDE}/${A}.`)) armed = true;
      return undefined;
    };
    await pass(w, proc(w, 100));
    expect(exists(w, `${ROOT}/${A}`)).toBe(false);
    expect(record(w)[0]).toMatchObject({ state: 'pending' });
    w.fs.frozen = false; w.fs.fault = () => undefined; w.alive.delete(100);
    w.tracked.names = [A];
    const report = await pass(w, proc(w, 101));
    expect(report.restored).toEqual([A]);
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(await w.fs.readdir({ path: ASIDE })).toEqual([]);
  });

  it('T-2c.9 unmounted parent volume ⇒ kept', async () => {
    const w = world();
    retire(w);
    await w.fs.rm({ path: '/sites' });
    const report = await pass(w, proc(w, 100));
    expect(report.kept).toContainEqual({ partition: A, reason: 'absence-uncertain' });
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
  });

  it('fault: a failed ledger transition before the rename leaves the partition in place', async () => {
    const w = world();
    retire(w);
    w.store.failWrite = v => JSON.stringify(v).includes('"lastReason":"renaming"');
    const report = await pass(w, proc(w, 100));
    expect(report.kept).toContainEqual({ partition: A, reason: 'ledger-unavailable' });
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
  });

  it('fault: a failed commit restores the partition in the same pass', async () => {
    const w = world();
    retire(w);
    w.store.failWrite = v => JSON.stringify(v).includes('"state":"removed"');
    const report = await pass(w, proc(w, 100));
    expect(report.removed).toEqual([]);
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(record(w)[0]).toMatchObject({ state: 'pending' });
  });

  it('fault: a busy aside rename keeps the record pending', async () => {
    const w = world();
    retire(w);
    w.fs.fault = (op, target) => (op === 'rename' && target.startsWith(`${ASIDE}/${A}.`) ? 'EBUSY' : undefined);
    const report = await pass(w, proc(w, 100));
    expect(report.kept).toContainEqual({ partition: A, reason: 'busy' });
    expect(record(w)[0]).toMatchObject({ state: 'pending', lastReason: 'busy' });
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
  });

  it('fault: a failed restore rename leaves the aside for the next start to restore', async () => {
    const w = world(), self = proc(w, 100);
    retire(w);
    onAsideRename(w, () => { w.tracked.names = [A]; });
    w.fs.fault = (op, target) => (op === 'rename' && target === `${ROOT}/${A}` ? 'EPERM' : undefined);
    await pass(w, self);
    expect(exists(w, `${ROOT}/${A}`)).toBe(false);
    w.fs.fault = () => undefined;
    const report = await pass(w, self);
    expect(report.restored).toEqual([A]);
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
  });

  it('fault: a failed target write stops the pass before anything moves', async () => {
    const w = world();
    retire(w);
    w.fs.fault = (op, _t, data) => (op === 'write' && data?.includes(`"target":"${A}"`) ? 'EIO' : undefined);
    const report = await pass(w, proc(w, 100));
    expect(report.result).toBe('failed');
    expect(w.fs.files.get(`${ROOT}/${A}/Cookies`)).toBe('jar');
    expect(record(w)[0]).toMatchObject({ state: 'pending' });
  });

  it('never deletes an unknown or invalidated whole aside by its name', async () => {
    const w = world();
    w.fs.tree(`${ASIDE}/${B}.abc`, { Cookies: 'jar' });
    w.fs.tree(`${ASIDE}/stray`, { x: '1' });
    w.fs.tree(`${ASIDE}/hold-${A}.1f`, { Cookies: 'held' });
    const report = await pass(w, proc(w, 100));
    expect(report.restored).toEqual([B]);
    expect(w.fs.files.get(`${ROOT}/${B}/Cookies`)).toBe('jar');
    expect(w.fs.files.get(`${ASIDE}/stray/x`)).toBe('1');
    expect(w.fs.files.get(`${ASIDE}/hold-${A}.1f/Cookies`)).toBe('held');
  });

  it('returns within the budget and keeps working in the background', async () => {
    const w = world();
    retire(w);
    const out = await runPartitionPass({
      interlock: proc(w, 100), ledger: w.ledger, fs: w.fs, root: { isManaged }, newToken: w.token,
      scheduler: { sleep: async () => {} }, maintenance: async () => {}, report: () => {},
    }, { budgetMs: 1 });
    expect(out.state).toBe('continuing');
    if (out.state === 'continuing') await expect(out.done).resolves.toMatchObject({ removed: [A] });
  });
});

describe('owner-confirmed sign-in removal', () => {
  const confirmation = { partition: B, confirmed: true as const, evidence: 'owner-dialog' as const };
  const remove = (w: World, interlock: ReturnType<typeof proc>, c: unknown) => removeAmbiguousPartition({
    partition: `persist:${B}`, interlock, ledger: w.ledger, fs: w.fs, root: { isManaged }, newToken: w.token,
    confirmation: c as typeof confirmation,
  });

  it('a pending automatic retirement cannot be manually removed', async () => {
    const w = world(), self = proc(w, 100);
    const pending = retire(w, B);
    const before = w.ledger.readStrict({}, {});
    expect(await listAmbiguousPartitions({
      readRoot: async () => ({ state: 'ok', root: ROOT }),
      list: ({ root }) => listCandidates({ root, fs: w.fs, isManaged }),
      readClaims: async () => ({ state: 'ok', claimed: [], otherInstances: [] }),
      readLedger: () => w.ledger.readStrict({}, {}),
    })).toEqual({ state: 'ok', candidates: [] });
    expect(await remove(w, self, confirmation)).toEqual({ state: 'kept', reason: 'protected' });
    expect(w.fs.files.get(`${ROOT}/${B}/Cookies`)).toBe('jar');
    expect(w.ledger.readStrict({}, {})).toEqual(before);
    expect(record(w)).toEqual([pending]);
  });

  it('holder or sibling appearing after confirmation keeps the partition', async () => {
    for (const arrival of ['holder', 'sibling', 'tracked']) {
      const w = world(), self = proc(w, 100);
      const bytes = { Cookies: 'jar', 'Local Storage/leveldb/1': 'local', 'IndexedDB/x/1': 'indexed' };
      w.fs.tree(`${ROOT}/${B}`, bytes);
      let acquired: Promise<unknown> = Promise.resolve();
      let fired = false;
      w.fs.gate = async (op, target) => {
        if (fired || op !== 'rename' || !target.startsWith(`${ASIDE}/${B}.`)) return;
        fired = true;
        if (arrival === 'tracked') w.tracked.names = [B];
        else {
          const sibling = proc(w, 200, { invalidates: false });
          if (arrival === 'holder') {
            acquired = sibling.acquireSiteSession({ partition: `persist:${B}`, subjectDir: '/sites/b' });
            await ticks();
          }
        }
      };
      expect(await remove(w, self, confirmation)).toEqual({ state: 'kept', reason: 'protected' });
      for (const [name, value] of Object.entries(bytes)) expect(w.fs.files.get(`${ROOT}/${B}/${name}`)).toBe(value);
      expect(await w.fs.readdir({ path: ASIDE })).toEqual([]);
      expect(record(w)[0]).toMatchObject({ basis: 'owner-dialog', state: 'invalidated' });
      if (arrival === 'holder') await expect(acquired).resolves.toMatchObject({ state: 'held' });
    }
  });

  it('manual sign-in removal without confirmation is refused', async () => {
    const w = world(), self = proc(w, 100);
    w.fs.tree(`${ROOT}/${B}`, { Cookies: 'jar' });
    for (const c of [undefined, { ...confirmation, confirmed: false }, { ...confirmation, evidence: 'auto' }, { ...confirmation, partition: A }]) {
      expect(await remove(w, self, c)).toEqual({ state: 'refused', reason: 'unconfirmed' });
    }
    expect(w.fs.files.get(`${ROOT}/${B}/Cookies`)).toBe('jar');
    expect(record(w)).toEqual([]);
    expect(await remove(w, self, confirmation)).toEqual({ state: 'removed' });
    expect(exists(w, `${ROOT}/${B}`)).toBe(false);
    expect(record(w)[0]).toMatchObject({ basis: 'owner-dialog', state: 'removed', partition: B });
  });

  it('holder appearing after confirm keeps the partition', async () => {
    const w = world(), self = proc(w, 100);
    w.fs.tree(`${ROOT}/${B}`, { Cookies: 'jar' });
    let acquired: Promise<unknown> = Promise.resolve();
    let fired = false;
    w.fs.gate = async (op, target) => {
      if (fired || op !== 'rename' || !target.startsWith(`${ASIDE}/${B}.`)) return;
      fired = true;
      acquired = proc(w, 200, { invalidates: false }).acquireSiteSession({ partition: `persist:${B}`, subjectDir: '/sites/b' });
      await ticks();
    };
    expect(await remove(w, self, confirmation)).toEqual({ state: 'kept', reason: 'protected' });
    expect(w.fs.files.get(`${ROOT}/${B}/Cookies`)).toBe('jar');
    expect(record(w)[0]).toMatchObject({ basis: 'owner-dialog', state: 'invalidated' });
    await expect(acquired).resolves.toMatchObject({ state: 'held' });
  });

  it('refuses while the partition is claimed or claims are unknown', async () => {
    const w = world(), self = proc(w, 100);
    w.fs.tree(`${ROOT}/${B}`, { Cookies: 'jar' });
    w.tracked.names = [B];
    expect(await remove(w, self, confirmation)).toEqual({ state: 'kept', reason: 'protected' });
    w.tracked = { names: [], unknown: true };
    expect(await remove(w, self, confirmation)).toEqual({ state: 'kept', reason: 'unknown' });
    expect(w.fs.files.get(`${ROOT}/${B}/Cookies`)).toBe('jar');
  });
});

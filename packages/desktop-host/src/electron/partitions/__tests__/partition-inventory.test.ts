import { describe, expect, it } from 'vitest';
import { createRetirementLedger, listAmbiguousPartitions, listCandidates } from '../index.js';
import type { ClaimsRead, RetirementRead } from '../index.js';
import { FakeClock } from './fakes.js';
import { MemoryDurableJson, PassFs } from './pass-fakes.js';

const ROOT = '/profile/session/Partitions';
const A = `site-${'a'.repeat(32)}`, B = `site-${'b'.repeat(32)}`;

describe('partition inventory', () => {
  it('listing never writes or acquires a session', async () => {
    const fs = new PassFs(), store = new MemoryDurableJson();
    const ledger = createRetirementLedger({ profile: '/profile', durableJson: store, clock: new FakeClock(), id: () => 'record' });
    fs.tree(`${ROOT}/${A}`, { Cookies: 'jar', 'Local Storage/x': 'local', 'IndexedDB/x': 'indexed' });
    fs.tree(`${ROOT}/${B}`, { Cookies: 'tracked' });
    fs.links.set(`${ROOT}/site-link`, `${ROOT}/${A}`);
    let writes = 0, sessions = 0;
    store.failWrite = () => { writes += 1; return true; };
    fs.fault = op => { if (['write', 'mkdir', 'rename', 'rm'].includes(op)) { writes += 1; return 'EIO'; } return undefined; };
    const files = [...fs.files], dirs = [...fs.dirs];
    const required = {
      readRoot: async () => ({ state: 'ok' as const, root: ROOT }),
      list: ({ root }: { root: string }) => listCandidates({ root, fs, isManaged: name => name.startsWith('site-') }),
      readClaims: async (): Promise<ClaimsRead> => ({ state: 'ok', claimed: [B], otherInstances: [] }),
      readLedger: () => ledger.readStrict({}, {}),
      acquireSiteSession: async () => { sessions += 1; },
      withPartitionWriter: async () => { writes += 1; },
    };
    expect(await listAmbiguousPartitions(required)).toEqual({ state: 'ok', candidates: [{ name: A, path: `${ROOT}/${A}` }] });
    expect(writes).toBe(0); expect(sessions).toBe(0);
    expect(store.value).toBeUndefined(); expect(store.quarantined).toBe(0);
    expect([...fs.files]).toEqual(files); expect([...fs.dirs]).toEqual(dirs);
  });

  it('unknown claims or ledger yields no actionable sign-ins', async () => {
    const candidate = { name: A, path: `${ROOT}/${A}` };
    let claims: ClaimsRead = { state: 'unknown', reasons: ['damaged claims'] };
    let ledger: RetirementRead = { state: 'ok', records: [] };
    const required = {
      readRoot: async () => ({ state: 'ok' as const, root: ROOT }),
      list: async () => ({ state: 'ok' as const, candidates: [candidate], skipped: [] }),
      readClaims: async () => claims, readLedger: () => ledger,
    };
    expect(await listAmbiguousPartitions(required)).toEqual({ state: 'unknown' });
    claims = { state: 'ok', claimed: [], otherInstances: [] };
    ledger = { state: 'unknown', reason: 'damaged ledger' };
    expect(await listAmbiguousPartitions(required)).toEqual({ state: 'unknown' });
    ledger = { state: 'ok', records: [] };
    claims = { state: 'ok', claimed: [], otherInstances: [200] };
    expect(await listAmbiguousPartitions(required)).toEqual({ state: 'ok', candidates: [] });
    expect(await listAmbiguousPartitions({ ...required, readRoot: async () => ({ state: 'absent' as const }) })).toEqual({ state: 'ok', candidates: [] });
    expect(await listAmbiguousPartitions({ ...required, readRoot: async () => ({ state: 'unknown' as const, reason: 'root unreadable' }) })).toEqual({ state: 'unknown' });
    expect(await listAmbiguousPartitions({ ...required, list: async () => ({ state: 'unknown' as const, reason: 'candidates unreadable' }) })).toEqual({ state: 'unknown' });
  });
});

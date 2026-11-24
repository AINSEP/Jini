import { describe, expect, it } from 'vitest';

import { createIdlePark } from '../idle-park.js';

/**
 * @file The framework-neutral idle park: request/watch/ledger/background vetoes, the no-await
 * recheck after the ledger query, fencing before stop, and failures staying busy. The host's HTTP
 * adapter (finish/close wiring, refusal copy) is covered by the host.
 */

const EXIT = 75;

type Deps = Parameters<typeof createIdlePark>[0];

function fixture({ hasActiveRuns = async () => false, activeCount = () => 0, hasBackgroundWork = async () => false }: Partial<Pick<Deps, 'hasActiveRuns' | 'activeCount' | 'hasBackgroundWork'>> = {}) {
  const stops: number[] = [];
  const park = createIdlePark({ hasActiveRuns, activeCount, hasBackgroundWork, exitCode: EXIT, stop: ({ exitCode }) => { stops.push(exitCode); } });
  return { park, stops };
}

describe('createIdlePark', () => {
  it('queued/running rows, finalizer watches and every admitted request independently veto sleep', async () => {
    for (const deps of [{ hasActiveRuns: async () => true }, { activeCount: () => 1 }]) {
      const f = fixture(deps);
      expect(await f.park.stopIfIdle({}, {})).toEqual({ idle: false });
      expect(f.stops).toEqual([]);
    }
    const f = fixture();
    const release = f.park.admit();
    expect(await f.park.stopIfIdle()).toEqual({ idle: false });
    release!();
    expect(await f.park.stopIfIdle()).toEqual({ idle: true });
    expect(f.stops).toEqual([EXIT]);
  });

  it('activity arriving during the ledger query is checked before fencing', async () => {
    let resolve!: (busy: boolean) => void;
    const f = fixture({ hasActiveRuns: () => new Promise<boolean>(r => { resolve = r; }) });
    const stopping = f.park.stopIfIdle();
    f.park.admit();
    resolve(false);
    expect(await stopping).toEqual({ idle: false });
    expect(f.stops).toEqual([]);
  });

  it('a watch installed during the query also vetoes sleep', async () => {
    let watches = 0;
    const f = fixture({ hasActiveRuns: async () => { watches = 1; return false; }, activeCount: () => watches });
    expect(await f.park.stopIfIdle()).toEqual({ idle: false });
  });

  it('errors and concurrent probes are busy; fencing precedes shutdown and prevents new intake', async () => {
    const broken = fixture({ hasActiveRuns: async () => { throw new Error('unavailable'); } });
    expect(await broken.park.stopIfIdle()).toEqual({ idle: false });
    expect(broken.park.admit()).toBeTypeOf('function');
    let park!: ReturnType<typeof createIdlePark>;
    const calls: number[] = [];
    park = createIdlePark({ hasActiveRuns: async () => false, hasBackgroundWork: async () => false, activeCount: () => 0, exitCode: EXIT,
      stop: ({ exitCode }) => {
        expect(park.admit(), 'fence must precede stop').toBeUndefined();
        calls.push(exitCode);
      },
    });
    const first = park.stopIfIdle();
    expect(await park.stopIfIdle()).toEqual({ idle: false });
    expect(await first).toEqual({ idle: true });
    expect(await park.stopIfIdle()).toEqual({ idle: false });
    expect(calls).toEqual([EXIT]);
  });

  it('a failing watch probe or shutdown effect leaves intake open and returns busy', async () => {
    const watches = fixture({ activeCount: () => { throw new Error('unknown watches'); } });
    expect(await watches.park.stopIfIdle()).toEqual({ idle: false });
    expect(watches.park.admit()).toBeTypeOf('function');
    const park = createIdlePark({ hasActiveRuns: async () => false, hasBackgroundWork: async () => false, activeCount: () => 0, exitCode: EXIT,
      stop: () => { throw new Error('shutdown unavailable'); },
    });
    expect(await park.stopIfIdle()).toEqual({ idle: false });
    expect(park.admit()).toBeTypeOf('function');
  });

  for (const job of ['publish', 'export', 'share upload', 'newsletter send']) {
    it(`a running ${job} keeps the process awake after its request is released`, async () => {
      let running = true;
      const f = fixture({ hasBackgroundWork: async () => running });
      f.park.admit()!();
      expect(await f.park.stopIfIdle()).toEqual({ idle: false });
      expect(f.stops).toEqual([]);
      running = false;
      expect(await f.park.stopIfIdle()).toEqual({ idle: true });
    });
  }

  it('release is idempotent: a second call does not free another request', async () => {
    const f = fixture();
    const a = f.park.admit()!;
    const b = f.park.admit()!;
    a();
    a();
    expect(await f.park.stopIfIdle(), 'second request still holds intake').toEqual({ idle: false });
    b();
    expect(await f.park.stopIfIdle()).toEqual({ idle: true });
    expect(f.stops).toEqual([EXIT]);
  });

  it('known requests and watches skip the ledger scan', async () => {
    let queries = 0;
    let watches = 1;
    const f = fixture({ hasActiveRuns: async () => { queries++; return false; }, activeCount: () => watches });
    expect(await f.park.stopIfIdle()).toEqual({ idle: false });
    watches = 0;
    const release = f.park.admit()!;
    expect(await f.park.stopIfIdle()).toEqual({ idle: false });
    expect(queries).toBe(0);
    release();
    expect(await f.park.stopIfIdle()).toEqual({ idle: true });
  });

  it('an uncertain background job probe keeps intake open', async () => {
    const f = fixture({ hasBackgroundWork: async () => { throw new Error('campaign storage unavailable'); } });
    expect(await f.park.stopIfIdle()).toEqual({ idle: false });
    expect(f.park.admit()).toBeTypeOf('function');
    expect(f.stops).toEqual([]);
  });
});

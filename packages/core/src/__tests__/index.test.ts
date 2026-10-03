import { describe, expect, it } from 'vitest';
import { bindings } from '../bindings.js';
import { createDaemon } from '../daemon.js';
import { definePack } from '../pack.js';
import { manyToken, token } from '../token.js';

interface RunStore {
  save(id: string): string[];
}

interface EventLog {
  append(event: string): void;
}

interface DeployProvider {
  name: string;
}

const RunStoreToken = token<RunStore>({ id: 'jini.runStore' });
const EventLogToken = token<EventLog>({ id: 'jini.eventLog' });
const DeployTargetToken = manyToken<DeployProvider>({ id: 'jini.deployTarget' });

/**
 * The compile-time `__missingBindings` gate (see daemon.ts) is exactly what
 * should stop these calls from typechecking — that's covered separately by
 * `compose.typecheck.ts`. Here we deliberately bypass it with `any` to reach
 * and assert on the runtime fallback messages.
 */
const createDaemonUnsafe = createDaemon as (config: any) => ReturnType<typeof createDaemon>;

describe('@jini-ai/core composition contract', () => {
  it('composes a pack against its bound dependencies and calls services() once', () => {
    const saved: string[] = [];
    const runStoreImpl: RunStore = { save: (id) => (saved.push(id), saved) };
    const eventLogImpl: EventLog = { append: () => {} };

    const runsPack = definePack({
      name: 'runs',
      deps: [RunStoreToken, EventLogToken],
      services: (c) => {
        const runStore = c.get({ token: RunStoreToken });
        const eventLog = c.get({ token: EventLogToken });
        return {
          start: (id: string) => {
            eventLog.append(`start:${id}`);
            return runStore.save(id);
          },
        };
      },
    });

    const daemon = createDaemon({
      packs: [runsPack],
      bindings: bindings({}).bind({ token: RunStoreToken, impl: runStoreImpl }).bind({ token: EventLogToken, impl: eventLogImpl }),
    });

    expect(daemon.services.runs.start('run_1')).toEqual(['run_1']);
  });

  it('aggregates multiple bindMany() calls in binding order for getMany()', () => {
    const netlify: DeployProvider = { name: 'netlify' };
    const vercel: DeployProvider = { name: 'vercel' };

    const deployPack = definePack({
      name: 'deploy',
      deps: [DeployTargetToken],
      services: (c) => ({ targets: c.getMany({ token: DeployTargetToken }) }),
    });

    const daemon = createDaemon({
      packs: [deployPack],
      bindings: bindings({}).bindMany({ token: DeployTargetToken, impl: netlify }).bindMany({ token: DeployTargetToken, impl: vercel }),
    });

    expect(daemon.services.deploy.targets).toEqual([netlify, vercel]);
  });

  it('resolveMany() returns an empty array for a many-token that was never bindMany()-ed', () => {
    expect(bindings({}).resolveMany({ token: DeployTargetToken })).toEqual([]);
  });

  it('throws a legible error when a required token is never bound', () => {
    const runsPack = definePack({
      name: 'runs',
      deps: [RunStoreToken],
      services: (c) => c.get({ token: RunStoreToken }),
    });

    expect(() =>
      createDaemonUnsafe({
        packs: [runsPack],
        bindings: bindings({}),
      }),
    ).toThrowError('missing binding: jini.runStore');
  });

  it('throws a legible error when a singleton token is bound twice', () => {
    expect(() => bindings({}).bind({ token: RunStoreToken, impl: { save: () => [] } }).bind({ token: RunStoreToken, impl: { save: () => [] } })).toThrowError(
      'duplicate binding: jini.runStore is already bound',
    );
  });

  it('throws a legible error when a bound implementation targets an incompatible token version', () => {
    const v1 = token<RunStore>({ id: 'jini.runStore' }, { version: 1 });
    const v2 = token<RunStore>({ id: 'jini.runStore' }, { version: 2 });

    const runsPack = definePack({
      name: 'runs',
      deps: [v2],
      services: (c) => c.get({ token: v2 }),
    });

    expect(() =>
      createDaemonUnsafe({
        packs: [runsPack],
        bindings: bindings({}).bind({ token: v1, impl: { save: () => [] } }),
      }),
    ).toThrowError('version-incompatible binding: jini.runStore expects v2, got v1');
  });

  it('refuses to resolve a token a pack never declared as a dep', () => {
    const sneakyPack = definePack({
      name: 'sneaky',
      deps: [],
      services: (c) => c.get({ token: RunStoreToken }),
    });

    expect(() =>
      createDaemonUnsafe({
        packs: [sneakyPack],
        bindings: bindings({}).bind({ token: RunStoreToken, impl: { save: () => [] } }),
      }),
    ).toThrowError('pack "sneaky" resolved "jini.runStore" without declaring it in deps');
  });
});

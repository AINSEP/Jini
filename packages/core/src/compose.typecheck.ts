/**
 * Type-level proof for the compile-time half of createDaemon()'s gate
 * (extraction-plan.md §2.2: "Exclude<RequiredTokenIds<packs>, BoundTokenIds<bindings>>
 * must be never"). Not a runtime test — `tsc --noEmit` is the test runner here:
 * if the `@ts-expect-error` line below ever stops erroring (e.g. the gate
 * regresses to accepting an under-bound daemon), `tsc` fails on an unused
 * `@ts-expect-error` directive, which fails `pnpm typecheck`.
 */
import { bindings } from './bindings.js';
import { createDaemon } from './daemon.js';
import { definePack } from './pack.js';
import { token } from './token.js';

interface RunStore {
  save(id: string): void;
}

const RunStoreToken = token<RunStore>({ id: 'jini.runStore' });

const runsPack = definePack({
  name: 'runs',
  deps: [RunStoreToken],
  services: (c) => c.get({ token: RunStoreToken }),
});

// @ts-expect-error — `jini.runStore` is required by `runsPack` but never bound.
createDaemon({
  packs: [runsPack],
  bindings: bindings({}),
});

// The same daemon typechecks once the required token is bound.
createDaemon({
  packs: [runsPack],
  bindings: bindings({}).bind({ token: RunStoreToken, impl: { save: () => {} } }),
});

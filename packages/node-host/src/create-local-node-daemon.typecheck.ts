/**
 * Type-level proof that `createLocalNodeDaemon` preserves `createDaemon`'s compile-time
 * "missing binding" gate through its own `CreateLocalNodeDaemonConfig` wrapper — see that
 * function's own doc and `foundry/docs/jini-port/extraction-plan.md` §1 ("the single biggest
 * correction"). Not a runtime test — `tsc --noEmit` is the test runner here: if the
 * `@ts-expect-error` line below ever stops erroring (e.g. the gate regresses to silently
 * accepting an under-bound daemon), `tsc` fails on an unused `@ts-expect-error` directive, which
 * fails `pnpm typecheck`. Mirrors `packages/core/src/compose.typecheck.ts`'s own pattern.
 */
import { definePack, token } from '@jini-ai/core';
import { createLocalNodeDaemon } from './create-local-node-daemon.js';

interface Greeter {
  greeting: string;
}

const GreeterToken = token<Greeter>('test.greeter');

const greetPack = definePack({
  name: 'greet',
  deps: [GreeterToken],
  services: (c) => ({ say: () => c.get(GreeterToken).greeting }),
});

// @ts-expect-error — `test.greeter` is required by `greetPack` but never bound (no `bindings`
// customizer was supplied, so only the two kernel tokens are considered bound).
void createLocalNodeDaemon({
  dataDir: '/tmp/jini-node-host-typecheck',
  packs: [greetPack],
});

// @ts-expect-error — a `bindings` customizer was supplied, but it never actually binds
// `test.greeter` (it's the identity function) — the gate must still catch an under-binding
// customizer, not just a fully-omitted one.
void createLocalNodeDaemon({
  dataDir: '/tmp/jini-node-host-typecheck',
  packs: [greetPack],
  bindings: (b) => b,
});

// Typechecks once the required token is bound via the `bindings` customizer callback.
void createLocalNodeDaemon({
  dataDir: '/tmp/jini-node-host-typecheck',
  packs: [greetPack],
  bindings: (b) => b.bind(GreeterToken, { greeting: 'hi' }),
});

// Also typechecks with a pack that declares no extra deps at all — only the two kernel tokens
// are ever required, so omitting `bindings` entirely is legal.
const noDepsPack = definePack({ name: 'noDeps', deps: [], services: () => ({}) });
void createLocalNodeDaemon({
  dataDir: '/tmp/jini-node-host-typecheck',
  packs: [noDepsPack],
});

/**
 * Type-level proof that the engine has NO trash retention default (owner decision G7-4): the
 * window is one host-owned value, injected into every call. Not a runtime test — `tsc --noEmit`
 * (`pnpm typecheck`) is the runner: if a default ever comes back (the parameter or the field turns
 * optional again), an `@ts-expect-error` below stops erroring and `tsc` fails on the unused
 * directive. Mirrors `packages/server/src/create-local-node-daemon.typecheck.ts`'s own pattern.
 */
import { computePurgeAfter, createTrashService, type TrashServiceDeps } from "../write-service.js";

declare const deps: TrashServiceDeps;
const at = "2026-09-20T12:00:00.000Z";

// @ts-expect-error retention is required: the host must inject it.
createTrashService(deps);
// @ts-expect-error an options object without retentionDays is still missing the window.
createTrashService(deps, { onError: () => {} });
createTrashService(deps, { retentionDays: 30 });

// @ts-expect-error computePurgeAfter has no default window either.
computePurgeAfter({ at });
// @ts-expect-error an empty policy object is still missing the window.
computePurgeAfter({ at }, {});
computePurgeAfter({ at }, { retentionDays: 30 });

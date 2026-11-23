import assert from "node:assert/strict";
import { test } from "vitest";

import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { createSurfaceExchangeStore } from "../surface-exchanges.js";

/**
 * @file Paired-cutover guard: `AssistantSurfaceDeps` now lives only in core, and the live store stays
 * in daemon. The store daemon builds must keep satisfying core's contract, so a host can hand
 * `createSurfaceExchangeStore(...)` straight to every surface-raising tool. `pnpm typecheck` compiles
 * the assignment below.
 */

const store = {} as ReturnType<typeof createSurfaceExchangeStore>;
const deps: AssistantSurfaceDeps = { surfaceExchanges: store };

test("the daemon-built surface-exchange store satisfies core AssistantSurfaceDeps", () => {
  assert.equal(deps.surfaceExchanges, store);
});

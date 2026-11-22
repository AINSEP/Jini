import assert from "node:assert/strict";
import { test } from "vitest";

import type { SurfaceExchangeStore } from "../../../surface-exchanges.js";
import type { AssistantSurfaceDeps } from "../daemon-surface-exchanges.js";

/**
 * @file Type fixture for the surface-raising tool dependency bag. `pnpm typecheck` compiles this file,
 * so renaming or retyping `surfaceExchanges` in the core contract fails here. The runtime assert only
 * checks the fixture hands the same store through unchanged.
 */

const store = {} as SurfaceExchangeStore;
const deps: AssistantSurfaceDeps = { surfaceExchanges: store };

test("AssistantSurfaceDeps hands tools the shared surface-exchange store", () => {
  assert.equal(deps.surfaceExchanges, store);
});

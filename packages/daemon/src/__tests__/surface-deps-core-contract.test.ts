import assert from "node:assert/strict";
import { test } from "vitest";

import type { AssistantSurfaceDeps as CoreAssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { SurfaceExchangeStore } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "../surface-exchanges.js";

/**
 * @file Additive-window guard: until the paired cutover removes the daemon declaration, the daemon
 * and core `AssistantSurfaceDeps` must stay assignable both ways, so a linked host can move its
 * imports to core one file at a time. `pnpm typecheck` compiles the two assignments below.
 */

const store = {} as SurfaceExchangeStore;
const fromDaemon: AssistantSurfaceDeps = { surfaceExchanges: store };
const toCore: CoreAssistantSurfaceDeps = fromDaemon;
const backToDaemon: AssistantSurfaceDeps = toCore;

test("daemon and core AssistantSurfaceDeps describe the same shared store", () => {
  assert.equal(backToDaemon.surfaceExchanges, store);
});

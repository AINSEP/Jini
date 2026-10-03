import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as barrel from "../index.js";
import { createRespawnPolicy } from "../respawn-policy.js";
import { createDaemonSupervisor } from "../supervisor.js";
import { createNodeDaemonProcessAdapter, createSupervisorRegistry, createNodeSupervisorScheduler } from "../supervisor-node.js";

// REGRESSION: fails if Node adapters are re-exported through the root/generic supervisor.
test("the barrel and subpaths expose the same lifecycle factories", () => {
  expect(barrel.createRespawnPolicy).toBe(createRespawnPolicy);
  expect(barrel.createDaemonSupervisor).toBe(createDaemonSupervisor);
  expect('createNodeDaemonProcessAdapter' in barrel).toBe(false);
  expect('createSupervisorRegistry' in barrel).toBe(false);
  expect('createNodeSupervisorScheduler' in barrel).toBe(false);
  expect(typeof createNodeDaemonProcessAdapter).toBe('function');
  expect(typeof createSupervisorRegistry).toBe('function');
  expect(typeof createNodeSupervisorScheduler).toBe('function');
});

// REGRESSION: fails if the isolated supervisor/node export is removed.
test("every published entry declares its runtime and lifecycle export targets", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.jini.entries).toEqual({ ".": "node", "./respawn-policy": "universal", "./supervisor": "universal", "./supervisor/node": "node" });
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  expect(manifest.exports["./supervisor"]).toEqual({ types: "./dist/supervisor.d.ts", import: "./dist/supervisor.js", default: "./dist/supervisor.js" });
});

import assert from "node:assert/strict";
import { test } from "vitest";

import { toAdminPluginResponse } from "../../admin-response.js";
import type { PluginDiscoveryRecord } from "../../discovery-types.js";
import { readPluginArchive, type PluginArchiveEntry, type PluginArchiveReaderPort } from "../../node/archive-policy.js";
import { PluginInstallError } from "../../node/install.js";
import { startTier2Worker } from "../../worker/start.js";
import { definePlugin } from "../support/fixture-sdk.js";
import { pluginSdkBinding, createInvocationCoreDeps } from "../support/fixture-bindings.js";
import type { Tier2Request } from "../../worker/protocol.js";

/**
 * @file EXTRACT-S6 L1c part 1 — second-host proofs for the three moved entries: the two-object admin
 * DTO, the bounded archive policy behind a host-supplied reader, and the tier-2 worker start with an
 * injected port, binding and SDK resolver. No product module is imported.
 */

const discovery: PluginDiscoveryRecord = { id: "p", name: "P", version: "1.0.0", source: "site", tier: "tier-2", status: "valid", errors: [] };

test("admin DTO: exact key order, null activation is disabled, conflicts default to []", () => {
  const out = toAdminPluginResponse({ discovery, activation: null });
  assert.equal(JSON.stringify(out), '{"id":"p","name":"P","version":"1.0.0","source":"site","tier":"tier-2","status":"valid","enabled":false,"quarantine":null,"errors":[],"conflicts":[]}');
});

test("admin DTO: missing tier falls back to tier-3; full quarantine and conflicts project", () => {
  const { tier: _tier, ...noTier } = discovery;
  const out = toAdminPluginResponse(
    { discovery: noTier, activation: { pluginId: "p", enabled: true, quarantinedAt: "t", quarantineReason: "r", quarantineFailureCount: 3 } as never },
    { conflicts: [{ kind: "tool", name: "x" } as never] },
  );
  assert.equal(out.tier, "tier-3");
  assert.equal(out.enabled, true);
  assert.deepEqual(out.quarantine, { at: "t", reason: "r", consecutiveFailures: 3 });
  assert.equal(out.conflicts.length, 1);
  assert.equal("providerSettings" in out, false);
});

function fileEntry(entryPath: string, bytes: Uint8Array): PluginArchiveEntry {
  return { kind: "file", entryPath, declaredSize: bytes.byteLength, openReadStream: async function* () { yield bytes; } };
}
function readerOf(entries: PluginArchiveEntry[], calls: { n: number }): PluginArchiveReaderPort {
  return { async *entries() { calls.n += 1; yield* entries; } };
}

test("archive: second-host reader is called once and accepted files come back keyed by path", async () => {
  const calls = { n: 0 };
  const files = await readPluginArchive({ archive: new Uint8Array(4), reader: readerOf([{ kind: "directory", entryPath: "dist/" }, fileEntry("dist\\a.js", new Uint8Array([1, 2]))], calls) });
  assert.equal(calls.n, 1);
  assert.deepEqual([...files.keys()], ["dist/a.js"]);
});

test("archive: refusals keep PluginInstallError identity, codes and text", async () => {
  const cases: [PluginArchiveEntry[], string, string][] = [
    [[{ kind: "symlink", entryPath: "l" }], "PLUGIN_PACKAGE_UNSAFE", "ZIP links are not allowed."],
    [[fileEntry("../x", new Uint8Array())], "PLUGIN_PACKAGE_UNSAFE", "ZIP paths must stay inside the package."],
    [[fileEntry("a", new Uint8Array()), fileEntry("a", new Uint8Array())], "PLUGIN_PACKAGE_UNSAFE", "ZIP has duplicate paths."],
    [[fileEntry("A/x", new Uint8Array()), fileEntry("a/y", new Uint8Array())], "PLUGIN_PACKAGE_UNSAFE", "ZIP has case-aliased paths."],
  ];
  for (const [entries, code, message] of cases) {
    await assert.rejects(readPluginArchive({ archive: new Uint8Array(1), reader: readerOf(entries, { n: 0 }) }), (error: unknown) =>
      error instanceof PluginInstallError && (error as PluginInstallError & { code: string }).code === code && error.message === message);
  }
});

test("archive: oversized upload is refused before the reader runs; foreign reader errors become PLUGIN_ARCHIVE_INVALID", async () => {
  const calls = { n: 0 };
  await assert.rejects(readPluginArchive({ archive: new Uint8Array(32 * 1024 * 1024 + 1), reader: readerOf([], calls) }), /32 MiB upload limit/);
  assert.equal(calls.n, 0);
  const broken: PluginArchiveReaderPort = { async *entries() { yield* []; throw new Error("bad zip"); } };
  await assert.rejects(readPluginArchive({ archive: new Uint8Array(1), reader: broken }), (error: unknown) =>
    error instanceof PluginInstallError && error.message === "ZIP could not be read safely.");
});

const request: Tier2Request = { kind: "probe", plugin: { pluginId: "t2", entryPath: "/plugins/t2/dist/plugin.js", capabilities: [], hooks: [] } };
const binding = { pluginSdkBinding, createInvocationCoreDeps };

test("worker start: resolver registers before the real import; the reply is posted once", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  await startTier2Worker({
    workerData: request, parentPort: { postMessage: (m) => posted.push(m) }, binding,
    registerSdkResolver: () => order.push("register"),
    realImport: async (p) => { order.push(`import ${p}`); return { default: definePlugin({ setup: () => undefined }) }; },
  });
  assert.deepEqual(order, ["register", "import /plugins/t2/dist/plugin.js"]);
  assert.equal(posted.length, 1);
  assert.equal((posted[0] as { ok: boolean }).ok, true);
});

test("worker start: an injected importModule registers nothing; no port throws before anything runs", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  const base = { workerData: request, binding, registerSdkResolver: () => order.push("register"), realImport: async () => { order.push("real"); return {}; } };
  await startTier2Worker({ ...base, parentPort: { postMessage: (m) => posted.push(m) } }, { importModule: async () => { order.push("injected"); return {}; } });
  assert.deepEqual(order, ["injected"]);
  await assert.rejects(startTier2Worker({ ...base, parentPort: null }), /must run inside a worker_threads Worker/);
  assert.deepEqual(order, ["injected"]);
});

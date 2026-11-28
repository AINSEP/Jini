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

test("admin DTO: providerSettings appears only when a declared provider has at least one setting", () => {
  const withProviders = (providers: unknown[]) => ({ ...discovery, manifest: { contributes: { providers } } } as unknown as PluginDiscoveryRecord);
  const configurable = toAdminPluginResponse({ discovery: withProviders([{ id: "a" }, { id: "b", settings: [{ key: "region" }] }]), activation: null });
  assert.equal(configurable.providerSettings, true);
  assert.equal(JSON.stringify(Object.keys(configurable).slice(-1)), '["providerSettings"]');
  assert.equal("providerSettings" in toAdminPluginResponse({ discovery: withProviders([{ id: "a", settings: [] }, { id: "b" }]), activation: null }), false);
  assert.equal("providerSettings" in toAdminPluginResponse({ discovery: { ...discovery, manifest: {} } as unknown as PluginDiscoveryRecord, activation: null }), false);
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

const MIB = 1024 * 1024;
/** A file entry that streams `chunks` (reusing one buffer) while claiming `declaredSize`. */
function streamedEntry(entryPath: string, chunk: Uint8Array, repeat: number, declaredSize: number | undefined): PluginArchiveEntry {
  return { kind: "file", entryPath, declaredSize, openReadStream: async function* () { for (let i = 0; i < repeat; i++) yield chunk; } };
}
async function refusal(entries: PluginArchiveEntry[]): Promise<{ code: string; message: string }> {
  const error = await readPluginArchive({ archive: new Uint8Array(1), reader: readerOf(entries, { n: 0 }) }).then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof PluginInstallError);
  return { code: (error as PluginInstallError & { code: string }).code, message: error.message };
}

test("archive: a path through a file and a file over a directory are both refused", async () => {
  assert.deepEqual(await refusal([fileEntry("a", new Uint8Array([1])), fileEntry("a/b", new Uint8Array([2]))]),
    { code: "PLUGIN_PACKAGE_UNSAFE", message: "ZIP path crosses a file." });
  assert.deepEqual(await refusal([fileEntry("a/b", new Uint8Array([1])), fileEntry("a", new Uint8Array([2]))]),
    { code: "PLUGIN_PACKAGE_UNSAFE", message: "ZIP file replaces a directory." });
  // A directory entry over an existing subtree is fine: only a FILE may not replace one.
  const files = await readPluginArchive({ archive: new Uint8Array(1), reader: readerOf([fileEntry("a/b", new Uint8Array([1])), { kind: "directory", entryPath: "a/" }], { n: 0 }) });
  assert.deepEqual([...files.keys()], ["a/b"]);
});

test("archive: entry count and distinct path prefixes are each capped at 4096", async () => {
  const dirs = (n: number): PluginArchiveEntry[] => Array.from({ length: n }, (_, i) => ({ kind: "directory", entryPath: `d${i}/` }));
  assert.equal((await readPluginArchive({ archive: new Uint8Array(1), reader: readerOf(dirs(4096), { n: 0 }) })).size, 0);
  assert.deepEqual(await refusal(dirs(4097)), { code: "PLUGIN_PACKAGE_TOO_LARGE", message: "ZIP has too many entries." });
  // One entry, 4097 nested prefixes: the prefix cap trips although the entry cap does not.
  const deep = Array.from({ length: 4097 }, () => "a").join("/");
  assert.deepEqual(await refusal([fileEntry(deep, new Uint8Array([1]))]), { code: "PLUGIN_PACKAGE_TOO_LARGE", message: "ZIP has too many files and directories." });
  const deepest = Array.from({ length: 4096 }, () => "a").join("/");
  assert.deepEqual([...(await readPluginArchive({ archive: new Uint8Array(1), reader: readerOf([fileEntry(deepest, new Uint8Array([1]))], { n: 0 }) })).keys()], [deepest]);
});

test("archive: a file without a declared size is kept with the bytes actually streamed", async () => {
  const files = await readPluginArchive({ archive: new Uint8Array(1), reader: readerOf([streamedEntry("x.js", new Uint8Array([7, 8]), 3, undefined)], { n: 0 }) });
  assert.deepEqual([...files.get("x.js")!], [7, 8, 7, 8, 7, 8]);
});

test("archive: insane or oversized declared sizes are refused before the file is opened", async () => {
  const opened: string[] = [];
  const declared = (declaredSize: number): PluginArchiveEntry => ({ kind: "file", entryPath: "big.bin", declaredSize,
    openReadStream: async function* () { opened.push("big.bin"); yield new Uint8Array(); } });
  for (const size of [-1, 1.5, Number.NaN, 16 * MIB + 1]) {
    assert.deepEqual(await refusal([declared(size)]), { code: "PLUGIN_PACKAGE_TOO_LARGE", message: "ZIP exceeds the file or expanded size limit." });
  }
  assert.deepEqual(opened, []);
  const exact = await readPluginArchive({ archive: new Uint8Array(1), reader: readerOf([streamedEntry("max.bin", new Uint8Array(MIB), 16, 16 * MIB)], { n: 0 }) });
  assert.equal(exact.get("max.bin")!.byteLength, 16 * MIB);
});

test("archive: a declared size that would push the expanded total past 64 MiB is refused", async () => {
  const chunk = new Uint8Array(MIB);
  const full = [0, 1, 2].map((i) => streamedEntry(`f${i}.bin`, chunk, 16, 16 * MIB));
  // 48 MiB + 1 byte already streamed; a further 16 MiB claim crosses the 64 MiB cap.
  let lastOpened = false;
  const last: PluginArchiveEntry = { kind: "file", entryPath: "last.bin", declaredSize: 16 * MIB, openReadStream: async function* () { lastOpened = true; yield chunk; } };
  assert.deepEqual(await refusal([...full, streamedEntry("one.bin", new Uint8Array([1]), 1, 1), last]),
    { code: "PLUGIN_PACKAGE_TOO_LARGE", message: "ZIP exceeds the file or expanded size limit." });
  assert.equal(lastOpened, false);
});

test("archive: streamed bytes are counted, so a file that lies about its size is refused past 16 MiB", async () => {
  assert.deepEqual(await refusal([streamedEntry("liar.bin", new Uint8Array(MIB), 17, 1)]),
    { code: "PLUGIN_PACKAGE_TOO_LARGE", message: "ZIP exceeds the file or expanded size limit." });
});

const request: Tier2Request = { kind: "probe", plugin: { pluginId: "t2", entryPath: "/plugins/t2/dist/plugin.js", packageRoot: "/plugins/t2", capabilities: [], hooks: [] } };
const binding = { pluginSdkBinding, createInvocationCoreDeps };

test("worker start: resolver registers before the real import; the reply is posted once", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  await startTier2Worker({
    workerData: request, parentPort: { postMessage: (m) => posted.push(m) }, binding,
    registerSdkResolver: () => order.push("register"),
    realImport: async (p) => { order.push(`import ${p}`); return { default: definePlugin({ setup: () => undefined }) }; },
  }, { importPolicy: { sdkSpecifiers: ["@example/sdk"] }, registerImportPolicy: () => order.push("policy") });
  assert.deepEqual(order, ["policy", "register", "import /plugins/t2/dist/plugin.js"]);
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

test("worker start: an entry that imports as no module object is probed as having no default export", async () => {
  const posted: unknown[] = [];
  await startTier2Worker({
    workerData: request, parentPort: { postMessage: (m) => posted.push(m) }, binding,
    registerSdkResolver: () => undefined, realImport: async () => null,
  });
  // A null namespace must not crash the read of `.default` (that would report a different stage/error).
  assert.deepEqual(posted, [{ ok: false, stage: "export", error: "plugin 't2' does not default-export definePlugin(...)" }]);
});

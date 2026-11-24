import assert from "node:assert/strict";
import { test } from "vitest";
import { createSharePolicy } from "../share-policy.js";
import { archiveRefusalName, IMPORT_REFUSAL_EXIT_CODE, IMPORT_SCHEMA_MISMATCH_EXIT_CODE, SiteShareRefusal } from "../share-refusal.js";

const MIB = 1024 * 1024;
const limits = { maxFiles: 2000, maxExpandedBytes: 300 * MIB, maxFileBytes: 64 * MIB } as const;
const policy = createSharePolicy({ limits, versionMismatchMessage: "host mismatch copy" });

test("archive refusal names preserve ordinary text and truncate without splitting astral characters", () => {
  assert.equal(archiveRefusalName({ name: "" }), "");
  assert.equal(archiveRefusalName({ name: "schema_普通😀" }), "schema_普通😀");
  assert.equal(archiveRefusalName({ name: "x".repeat(120) }), "x".repeat(120));
  assert.equal(archiveRefusalName({ name: "x".repeat(121) }), "x".repeat(119) + "…");
  assert.equal(archiveRefusalName({ name: "x".repeat(118) + "😀tail" }), "x".repeat(118) + "…");
  assert.equal(archiveRefusalName({ name: "a\u0001b‮c" }), "abc");
});

test("a refusal carries its code, name and cause; worker exit codes stay distinct", () => {
  const cause = new Error("inner");
  const refusal = new SiteShareRefusal({ code: "X", message: "m" }, { cause });
  assert.deepEqual([refusal.code, refusal.message, refusal.name, refusal.cause], ["X", "m", "SiteShareRefusal", cause]);
  assert.notEqual(IMPORT_SCHEMA_MISMATCH_EXIT_CODE, IMPORT_REFUSAL_EXIT_CODE);
});

test("the policy hands back the injected limits and version-mismatch copy", () => {
  assert.equal(policy.limits, limits);
  assert.equal(policy.versionMismatchMessage, "host mismatch copy");
});

test("file, expanded-total and ordinary-file caps refuse with the exact copy for the injected limits", () => {
  const files = Array.from({ length: 2001 }, (_, index) => ({ path: `f${index}`, bytes: 1 }));
  assert.throws(() => policy.checkShareLimits({ files }), { code: "LIMIT_EXCEEDED", message: "Share exceeds the 2,000-file cap. Reduce the site or wait for streaming exports." });
  assert.doesNotThrow(() => policy.checkShareLimits({ files: files.slice(0, 2000) }));
  assert.throws(() => policy.checkShareLimits({ files: [{ path: "a", bytes: 300 * MIB }, { path: "b", bytes: 1 }] }), { code: "LIMIT_EXCEEDED", message: "Share exceeds the 300 MiB expanded cap. Reduce the site or wait for streaming exports." });
  assert.throws(() => policy.checkShareLimits({ files: [{ path: "a", bytes: 1 }], totalBytes: 300 * MIB + 1 }), { code: "LIMIT_EXCEEDED" });
  assert.doesNotThrow(() => policy.checkShareLimits({ files: [{ path: "a", bytes: 1 }], totalBytes: 300 * MIB }));
  assert.throws(() => policy.checkShareLimits({ files: [{ path: "themes/huge.js", bytes: 64 * MIB + 1 }] }), { code: "LIMIT_EXCEEDED", message: "Share file 'themes/huge.js' exceeds the 64 MiB ordinary-file cap." });
  assert.doesNotThrow(() => policy.checkShareLimits({ files: [{ path: "themes/ok.js", bytes: 64 * MIB }] }));
});

test("the share database is exempt from the per-file cap but not the total cap", () => {
  assert.doesNotThrow(() => policy.checkShareLimits({ files: [{ path: "database/content.db", bytes: 64 * MIB + 1 }] }));
  assert.doesNotThrow(() => policy.checkShareLimits({ files: [{ path: "content.db", bytes: 64 * MIB + 1 }] }));
  assert.throws(() => policy.checkShareLimits({ files: [{ path: "database/content.db", bytes: 300 * MIB + 1 }] }), { message: /expanded cap/ });
});

test("an oversize name is bounded and stripped of invisible controls in the refusal", () => {
  const path = `x‮${"y".repeat(200)}`;
  assert.throws(() => policy.checkShareLimits({ files: [{ path, bytes: 64 * MIB + 1 }] }), error => {
    assert.ok(error instanceof SiteShareRefusal);
    assert.ok(error.message.includes(`'${"x" + "y".repeat(118)}…'`));
    return true;
  });
});

test("copy numbers follow the injected limits, not constants", () => {
  const small = createSharePolicy({ limits: { maxFiles: 12_345, maxExpandedBytes: 5 * MIB, maxFileBytes: 2 * MIB }, versionMismatchMessage: "m" });
  assert.throws(() => small.checkShareLimits({ files: Array.from({ length: 12_346 }, (_, i) => ({ path: `f${i}`, bytes: 0 })) }), { message: /12,345-file cap/ });
  assert.throws(() => small.checkShareLimits({ files: [{ path: "a", bytes: 5 * MIB + 1 }] }), { message: /5 MiB expanded cap/ });
  assert.throws(() => small.checkShareLimits({ files: [{ path: "a", bytes: 2 * MIB + 1 }] }), { message: /2 MiB ordinary-file cap/ });
});

test("a host may name its own uncapped files, which replaces the default pair", () => {
  const custom = createSharePolicy({ limits, versionMismatchMessage: "m" }, { uncappedFilePaths: ["data/site.db"] });
  assert.doesNotThrow(() => custom.checkShareLimits({ files: [{ path: "data/site.db", bytes: 64 * MIB + 1 }] }));
  assert.throws(() => custom.checkShareLimits({ files: [{ path: "content.db", bytes: 64 * MIB + 1 }] }), { message: /ordinary-file cap/ });
});

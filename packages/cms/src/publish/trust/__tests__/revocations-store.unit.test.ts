import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createInMemoryRevocations,
  MAX_REVOCATIONS,
  parseRevocationDocument,
  type PublishTrustRevocation,
} from "../revocations.js";

/**
 * @file Branch-by-branch pins for the revocation parser and in-memory adapter: every reason
 * verbatim, the ORDER checks run in, and when the store changes. The deny list is the half of
 * publish-trust that must fail closed, so "which reason wins" and no-op edits are pinned.
 */

const NOW = "2026-09-19T12:00:00.000Z";

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sourceInstallationId: "src-a", revokedAt: NOW, note: null, ...overrides };
}

function reasonFor(text: string): string | null {
  const read = parseRevocationDocument({ text });
  return read.ok ? null : read.reason;
}

function entryReason(value: unknown): string | null {
  return reasonFor(JSON.stringify([value]));
}

function revocations(count: number): PublishTrustRevocation[] {
  return Array.from({ length: count }, (_, i) => ({ sourceInstallationId: `src-${i}`, revokedAt: NOW, note: null }));
}

test("a document one byte over the bound is refused before it is parsed", () => {
  assert.equal(reasonFor(" ".repeat(16_385)), "revocation list exceeds 16384 bytes");
});

test("a whitespace document at the bound is an empty list", () => {
  assert.deepEqual(parseRevocationDocument({ text: " ".repeat(16_384) }), { ok: true, revocations: [] });
});

test("an empty document is an empty list", () => {
  assert.deepEqual(parseRevocationDocument({ text: "" }), { ok: true, revocations: [] });
});

test("invalid JSON is refused with the parser's own message", () => {
  let message = "";
  try {
    JSON.parse("{oops");
  } catch (error) {
    message = (error as Error).message;
  }
  assert.equal(reasonFor("{oops"), `revocation list is not valid JSON: ${message}`);
});

test("a JSON object is refused as not an array", () => {
  assert.equal(reasonFor("{}"), "revocation list must be a JSON array");
});

test("65 records are refused before any record is inspected", () => {
  assert.equal(reasonFor(JSON.stringify(Array.from({ length: 65 }, () => null))), "revocation list holds more than 64 records");
});

test("64 valid records are accepted", () => {
  const read = parseRevocationDocument({ text: JSON.stringify(revocations(MAX_REVOCATIONS)) });
  assert.equal(read.ok && read.revocations.length, MAX_REVOCATIONS);
});

for (const value of [null, "src-a", 4]) {
  test(`record ${JSON.stringify(value)} is refused as not an object`, () => {
    assert.equal(entryReason(value), "each revocation must be an object");
  });
}

test("an array record passes the object check and is refused for its missing id", () => {
  assert.equal(entryReason([]), "each revocation needs a 'sourceInstallationId'");
});

for (const sourceInstallationId of ["", "x".repeat(513), 3, undefined]) {
  test(`sourceInstallationId ${JSON.stringify(sourceInstallationId)?.slice(0, 12)} is refused`, () => {
    assert.equal(entryReason(entry({ sourceInstallationId })), "each revocation needs a 'sourceInstallationId'");
  });
}

test("the id is checked before the revocation date", () => {
  assert.equal(entryReason(entry({ sourceInstallationId: "", revokedAt: "never" })), "each revocation needs a 'sourceInstallationId'");
});

for (const revokedAt of ["", "never", 1, "x".repeat(513)]) {
  test(`revokedAt ${JSON.stringify(revokedAt).slice(0, 12)} is refused`, () => {
    assert.equal(entryReason(entry({ revokedAt })), "each revocation needs an ISO-8601 'revokedAt'");
  });
}

test("the revocation date is checked before the note", () => {
  assert.equal(entryReason(entry({ revokedAt: "never", note: "" })), "each revocation needs an ISO-8601 'revokedAt'");
});

for (const note of ["", "n".repeat(513), 5, false]) {
  test(`note ${JSON.stringify(note).slice(0, 12)} is refused`, () => {
    assert.equal(entryReason(entry({ note })), "a revocation 'note' must be a non-empty string when present");
  });
}

test("records keep only their three fields, a string note verbatim and an absent note as null", () => {
  const { note: _note, ...withoutNote } = entry({ sourceInstallationId: "src-b" });
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([{ ...entry({ note: "lost laptop" }), extra: 1 }, withoutNote]) }), {
    ok: true,
    revocations: [
      { sourceInstallationId: "src-a", revokedAt: NOW, note: "lost laptop" },
      { sourceInstallationId: "src-b", revokedAt: NOW, note: null },
    ],
  });
});

test("the first bad record decides the reason", () => {
  assert.equal(reasonFor(JSON.stringify([entry(), entry({ revokedAt: "never" }), null])), "each revocation needs an ISO-8601 'revokedAt'");
});

test("the in-memory adapter has no path and starts empty", async () => {
  const port = createInMemoryRevocations();
  assert.equal("path" in port, false);
  assert.deepEqual(await port.list(), { ok: true, revocations: [] });
});

test("an in-memory revoke appends, and a repeat keeps the first record", async () => {
  const port = createInMemoryRevocations();
  const first = await port.revoke({ sourceInstallationId: "src-a", nowIso: NOW, note: "stolen" });
  const again = await port.revoke({ sourceInstallationId: "src-a", nowIso: "2027-01-01T00:00:00.000Z" });
  const expected = [{ sourceInstallationId: "src-a", revokedAt: NOW, note: "stolen" }];
  assert.deepEqual(first, { ok: true, revocations: expected, changed: true });
  assert.deepEqual(again, { ok: true, revocations: expected, changed: false });
});

test("an in-memory revoke without a note stores null", async () => {
  const result = await createInMemoryRevocations().revoke({ sourceInstallationId: "src-a", nowIso: NOW });
  assert.deepEqual(result, { ok: true, revocations: [{ sourceInstallationId: "src-a", revokedAt: NOW, note: null }], changed: true });
});

test("an in-memory restore removes the record and a repeat is a no-op", async () => {
  const port = createInMemoryRevocations();
  await port.revoke({ sourceInstallationId: "src-a", nowIso: NOW });
  assert.deepEqual(await port.restore({ sourceInstallationId: "src-a" }), { ok: true, revocations: [], changed: true });
  assert.deepEqual(await port.restore({ sourceInstallationId: "src-a" }), { ok: true, revocations: [], changed: false });
});

test("an in-memory no-op hands back the stored list itself", async () => {
  const port = createInMemoryRevocations();
  const first = await port.revoke({ sourceInstallationId: "src-a", nowIso: NOW });
  const noop = await port.restore({ sourceInstallationId: "src-z" });
  assert.equal(first.ok && noop.ok && noop.revocations === first.revocations, true);
});

test("an in-memory revoke past the bound is refused and stores nothing", async () => {
  const port = createInMemoryRevocations();
  for (let i = 0; i < MAX_REVOCATIONS; i += 1) await port.revoke({ sourceInstallationId: `src-${i}`, nowIso: NOW });
  const again = await port.revoke({ sourceInstallationId: "src-0", nowIso: NOW });
  assert.equal(again.ok && again.changed, false, "a repeat revoke at the bound is a no-op, not a refusal");
  assert.deepEqual(await port.revoke({ sourceInstallationId: "src-new", nowIso: NOW }), {
    ok: false,
    reason: "this site already lists 64 disconnected computers",
  });
  const listed = await port.list();
  assert.equal(listed.ok && listed.revocations.length, MAX_REVOCATIONS);
});

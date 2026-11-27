import assert from "node:assert/strict";
import { test } from "vitest";

import { clear, DefinitionNotFoundError, getEffective, InMemorySettingsRepo, set, SettingsRevisionConflictError } from "@jini-ai/core/settings";
import type { JsonValue } from "@jini-ai/core/primitives";

import {
  ensureMailProviderSettings, parseMailProviderSetting, parseMailTestMode, readMailProviderSelection,
  readMailProviderSetting, readMailTestMode, writeMailProviderSetting,
} from "../mail-provider.js";

const workspaceId = "newsroom";
const callerPrincipalId = "editor";
const now = "2026-11-23T12:00:00.000Z";
const selection = { transactional: "postmark", bulk: null };
const offLanes = { transactional: null, bulk: null };

function fixture() {
  const repo = new InMemorySettingsRepo();
  let next = 0;
  const clock = { nowMs: () => Date.parse(now), nowIso: () => now };
  const ids = { newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}` };
  const principals = { findActiveById: async () => null };
  const deps = { repo, clock, ids, principals, authorize: async () => ({ allowed: true, reason: "test" }) };
  const read = { settingsRepo: repo, workspaceId };
  const ensure = () => ensureMailProviderSettings({ deps: { settingsRepo: repo, clock, ids, principals }, systemPrincipalId: "system" });
  const put = (key: string, value: JsonValue) => set({ deps, input: {
    namespace: "core.mail", key, scope: "workspace", workspaceId, callerPrincipalId, value,
  } });
  const required = { deps, workspaceId, callerPrincipalId, writePolicies: { dedicatedWriters: [] } };
  return { repo, read, ensure, put, required };
}

test("an unregistered provider is unset for boot but unavailable to the addressed revision reader", async () => {
  const { read } = fixture();
  assert.equal(await readMailProviderSetting(read), null);
  await assert.rejects(readMailProviderSelection(read), (error: unknown) =>
    error instanceof DefinitionNotFoundError && error.message === "Mail provider settings are unavailable. Nothing was changed. Try again after this site finishes starting.");
  assert.deepEqual(await readMailTestMode(read), { mode: "off" });
});

test("registration distinguishes an unset provider from explicit off and does not replace the stored lanes", async () => {
  const { read, ensure, put, repo } = fixture();
  await ensure();
  assert.equal(await readMailProviderSetting(read), null);
  assert.deepEqual(await readMailProviderSelection(read), { setting: offLanes, revisionSeq: 0 });
  assert.deepEqual(await readMailTestMode(read), { mode: "off" });
  const mode = await getEffective({ deps: { repo }, namespace: "core.mail", key: "testMode", scopeContext: { workspaceId } });
  assert.deepEqual(mode?.value, { mode: "off" });

  const saved = await put("provider", offLanes);
  await ensure();
  assert.deepEqual(await readMailProviderSetting(read), offLanes);
  assert.deepEqual(await readMailProviderSelection(read), { setting: offLanes, revisionSeq: saved.revisionSeq });
  assert.equal(await readMailProviderSetting({ ...read, workspaceId: "another-site" }), null);
});

test("a corrupt stored lane is disarmed without being mistaken for the first boot", async () => {
  const { read, ensure, put } = fixture();
  await ensure();
  const saved = await put("provider", { transactional: "postmark", bulk: "" });
  assert.deepEqual(await readMailProviderSetting(read), offLanes);
  assert.deepEqual(await readMailProviderSelection(read), { setting: offLanes, revisionSeq: saved.revisionSeq });
});

test("a stale provider approval does not overwrite the newer lane assignment", async () => {
  const { ensure, read, required } = fixture();
  await ensure();
  const prepared = await readMailProviderSelection(read);
  await writeMailProviderSetting({ ...required, value: selection }, { expectedRevisionSeq: prepared.revisionSeq });
  const current = await readMailProviderSelection(read);
  assert.deepEqual(current.setting, selection);
  await assert.rejects(writeMailProviderSetting({ ...required, value: { transactional: null, bulk: "campaigns" } },
    { expectedRevisionSeq: prepared.revisionSeq }), (error: unknown) =>
    error instanceof SettingsRevisionConflictError && error.expectedRevisionSeq === 0 && error.actualRevisionSeq === current.revisionSeq);
  assert.deepEqual(await readMailProviderSelection(read), current);
});

test("provider parsing keeps lane positions and only accepts nonempty strings or explicit nulls", () => {
  assert.deepEqual(parseMailProviderSetting({ value: { transactional: null, bulk: "bulk-mailer" } }), { transactional: null, bulk: "bulk-mailer" });
  assert.deepEqual(parseMailProviderSetting({ value: selection }), selection);
  for (const value of [undefined, null, [], "postmark", { transactional: 42, bulk: "bulk-mailer" }, { transactional: "postmark" }] satisfies (JsonValue | undefined)[]) {
    assert.deepEqual(parseMailProviderSetting({ value }), offLanes);
  }
});

test("mail test mode reads redirects, capture and fail-closed values fresh on every send", async () => {
  const { ensure, read, put } = fixture();
  await ensure();
  await put("testMode", { mode: "redirect", to: "  qa@example.test  " });
  assert.deepEqual(await readMailTestMode(read), { mode: "redirect", to: "qa@example.test" });
  await put("testMode", { mode: "capture" });
  assert.deepEqual(await readMailTestMode(read), { mode: "capture" });
  await put("testMode", { mode: "redirect", to: "not-an-address" });
  assert.deepEqual(await readMailTestMode(read), { mode: "off" });
});

test("test mode parsing cannot activate a redirect from an unknown mode or non-string address", () => {
  for (const value of [undefined, null, [], "capture", { mode: "typo", to: "qa@example.test" }, { mode: "redirect", to: 5 }] satisfies (JsonValue | undefined)[]) {
    assert.deepEqual(parseMailTestMode({ value }), { mode: "off" });
  }
});

test("a cleared mail provider uses unset defaults without losing the addressed revision", async () => {
  const { ensure, put, read, required } = fixture();
  await ensure();
  const stored = await put("provider", selection);
  const result = await clear({ deps: required.deps, input: {
    namespace: "core.mail", key: "provider", scope: "workspace", workspaceId, callerPrincipalId,
  } });
  assert.equal(result.revisionSeq, stored.revisionSeq + 1);
  assert.equal(await readMailProviderSetting(read), null);
  assert.deepEqual(await readMailProviderSelection(read), { setting: offLanes, revisionSeq: result.revisionSeq });
});

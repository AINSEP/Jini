import assert from "node:assert/strict";
import { test } from "vitest";

import { deleteFormSubmission } from "./support/host-ports.fixture.js";
import type { FormSubmissionRepoPort, RemoveFormSubmissionFn } from "./support/repo-ports.fixture.js";

const required = { workspaceId: "ws-a", form: { id: "form-a", name: "Contact" }, submissionId: "sub-a", actor: { principalId: "owner", pluginId: "operator-tool" } };
const submission = { id: "sub-a", workspaceId: "ws-a", formDefinitionId: "form-a", data: { email: "private@example.com" }, sourceIp: "192.0.2.1", submittedAt: "2026-09-30T10:00:00Z" };
function repo(record: typeof submission | null): FormSubmissionRepoPort {
  return {
    findById: async (query) => query.workspaceId === "ws-a" && query.id === "sub-a" ? record : null,
    create: async () => assert.fail("unexpected create"), transaction: async () => assert.fail("unexpected transaction"), listByDefinition: async () => assert.fail("unexpected list"),
  };
}

for (const outcome of [{ ok: true, version: null }, { ok: false, reason: "not-found" }, { ok: false, reason: "version-changed" }] as const) {
  test(`Trash outcome ${JSON.stringify(outcome)} is forwarded, with exact privacy-safe display and attribution`, async () => {
    const calls: Parameters<RemoveFormSubmissionFn>[0][] = [];
    const result = await deleteFormSubmission(required, { submissionRepo: repo(submission), clock: { nowMs: () => Date.parse("2026-10-01T12:00:00Z") }, remove: async (input) => { calls.push(input); return outcome; } });
    assert.deepEqual(result, outcome.ok ? { ok: true } : outcome);
    // F2.5: remove is the injected domain boundary; route tests exercise actual Trash effects.
    assert.deepEqual(calls, [{ workspaceId: "ws-a", id: "sub-a", display: { title: "Contact", subtitle: "2026-09-30T10:00:00Z" }, at: "2026-10-01T12:00:00.000Z", expectedVersion: null, actor: { principalId: "owner", pluginId: "operator-tool" } }]);
  });
}

for (const record of [null, { ...submission, formDefinitionId: "other-form" }]) {
  test(`a ${record === null ? "missing" : "different-form"} submission cannot reach Trash`, async () => {
    assert.deepEqual(await deleteFormSubmission(required, { submissionRepo: repo(record), clock: { nowMs: () => { assert.fail("clock should not be read"); } }, remove: async () => { assert.fail("submission must not be removed"); } }), { ok: false, reason: "not-found" });
  });
}

for (const stage of ["read", "remove"] as const) {
  test(`a ${stage} storage failure propagates instead of returning a deletion receipt`, async () => {
    // F6.2/F5.5: an unexpected storage failure must never be reported as a successful deletion.
    const fault = new Error(`${stage} unavailable`);
    const submissionRepo = repo(submission);
    if (stage === "read") submissionRepo.findById = async () => { throw fault; };
    await assert.rejects(deleteFormSubmission(required, {
      submissionRepo, clock: { nowMs: () => Date.parse("2026-10-01T12:00:00Z") },
      remove: async () => { if (stage === "read") assert.fail("read failure must stop before removal"); throw fault; },
    }), (error) => error === fault);
  });
}

import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryEventBus, InMemoryOutbox } from "./eventing.fixture.js";
import { createRateLimiter } from "./support/host-ports.fixture.js";
import { FormDefinitionNotFoundError, FormFieldValidationError } from "../index.js";
import { FORMS_SUBMIT_PROFILE } from "./support/host-ports.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./support/repo-ports.fixture.js";
import { submitForm } from "./support/host-ports.fixture.js";
import { createFormDefinition } from "./support/host-ports.fixture.js";
import { executeCommand, InMemoryChangeSetRepo } from "./support/host-ports.fixture.js";
import type { FormDefinitionRecord } from "../index.js";

/**
 * @file Additional edge-case coverage (tasks.md T046): EC-01 (only-required-fields submission, at
 * the integration level via `submitForm`, not just `validateSubmissionPayload`'s unit test),
 * EC-05 (definition disabled mid-flight of an in-progress submission), and the
 * behavior.spec.md §7 boundary matrix rows not yet covered elsewhere: notify recipients at
 * exactly 10 (accepted) and 11 (rejected).
 */
const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";
const ACTOR = { id: "principal-1", kind: "user" as const };

function makeWriteDeps() {
  const repo = new InMemoryFormDefinitionRepo();
  const clock = { nowIso: () => NOW, nowMs: () => Date.parse(NOW) };
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  const changeSets = new InMemoryChangeSetRepo();
  const authorize = async () => ({ allowed: true, reason: "ok" });
  return { repo, clock, idGen, changeSets, authorize, executeCommand };
}

test("behavior.spec.md §7 — notify.recipients at exactly 10 is accepted", async () => {
  const deps = makeWriteDeps();
  const recipients = Array.from({ length: 10 }, (_, i) => `r${i}@example.com`);
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
      notify: { enabled: true, recipients },
    },
  });
  assert.equal(definition.notify.recipients.length, 10);
});

test("behavior.spec.md §7 — notify.recipients at 11 is rejected with FormFieldValidationError", async () => {
  const deps = makeWriteDeps();
  const recipients = Array.from({ length: 11 }, (_, i) => `r${i}@example.com`);
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          name: "Contact",
          slug: "contact",
          fields: [{ id: "name", label: "Name", type: "text", required: true }],
          notify: { enabled: true, recipients },
        },
      }),
    FormFieldValidationError
  );
});

function makeDefinition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "def-1",
    workspaceId: WORKSPACE_ID,
    name: "Contact",
    slug: "contact",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "email", label: "Email", type: "email", required: true },
      { id: "message", label: "Message", type: "textarea", required: false, maxLength: 500 },
    ],
    notify: { enabled: false, recipients: [] },
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function makeSubmitDeps() {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const clock = { nowIso: () => NOW, nowMs: () => Date.parse(NOW) };
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  const rateLimiter = createRateLimiter({ profile: FORMS_SUBMIT_PROFILE, clock });
  return { definitionRepo, submissionRepo, outbox, bus, clock, idGen, rateLimiter };
}

test("EC-01: a submission supplying only required fields is accepted; omitted optional fields are absent from data", async () => {
  const deps = makeSubmitDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      slug: "contact",
      body: { name: "Ada", email: "ada@example.com" },
      sourceIp: "1.1.1.1",
    },
  });
  assert.equal(result.status, "accepted");

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.ok(page.items[0]);
  assert.deepEqual(page.items[0].data, { name: "Ada", email: "ada@example.com" });
  assert.ok(!("message" in page.items[0].data));
});

test("EC-05: a definition disabled after submitForm's status check still accepts the in-flight submission", async () => {
  // Wraps the real repo so disabling happens exactly between submitForm's `findBySlug` status
  // check and the rest of its work — proving there is no second status re-check later in the
  // control flow (by construction: submitForm reads the definition exactly once).
  const realRepo = new InMemoryFormDefinitionRepo();
  await realRepo.create(makeDefinition());

  let disabledMidFlight = false;
  const interceptingRepo: import("../ports.js").FormDefinitionRepoPort = {
    findById: (input) => realRepo.findById(input),
    list: (input) => realRepo.list(input),
    create: (record) => realRepo.create(record),
    update: (record) => realRepo.update(record),
    isSlugTaken: (target) => realRepo.isSlugTaken(target),
    findBySlug: async (input) => {
      const found = await realRepo.findBySlug(input);
      // Simulate an admin's disable committing right after this read returns.
      if (found) {
        await realRepo.update({ ...found, status: "disabled" });
        disabledMidFlight = true;
      }
      return found;
    },
  };

  const deps = { ...makeSubmitDeps(), definitionRepo: interceptingRepo };

  const result = await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });

  assert.equal(disabledMidFlight, true);
  assert.equal(result.status, "accepted");

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 1);

  // Confirm the definition really is disabled now — a SUBSEQUENT submission is rejected.
  const definitionNow = await realRepo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "contact" });
  assert.equal(definitionNow?.status, "disabled");
  await assert.rejects(
    () => submitForm({ deps, input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Grace", email: "grace@example.com" }, sourceIp: "2.2.2.2" } }),
    FormDefinitionNotFoundError
  );
  assert.equal((await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 })).items.length, 1);
});

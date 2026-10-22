import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryEventBus, InMemoryOutbox } from "./eventing.fixture.js";
import { createRateLimiter } from "./eventing.fixture.js";
import { FormDefinitionNotFoundError, FormRateLimitExceededError, FormSubmissionValidationError } from "../errors.js";

import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./repo.fixture.js";
import { submitForm } from "../submit-service.js";
import type { FormDefinitionRecord } from "../types.js";

const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";

function makeDefinition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "def-1",
    workspaceId: WORKSPACE_ID,
    name: "Contact",
    slug: "contact",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "email", label: "Email", type: "email", required: true },
    ],
    notify: { enabled: false, recipients: [] },
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDeps() {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const clock = { nowMs: () => Date.parse(NOW)};
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  const rateLimiter = createRateLimiter();
  const warnings: unknown[] = [];
  const logger = { warn: (args: unknown) => { warnings.push(args); } };
  const dispatcher = { async dispatch() { const events = outbox.events.splice(0); for (const event of events) await bus.publish(event); } };
  return { definitionRepo, submissionRepo, outbox, bus, clock, idGen, rateLimiter, dispatcher, logger, warnings };
}

test("submitForm: AC-07/REQ-05 — accepts a valid submission to an active form", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });
  assert.equal(result.status, "accepted");
});

test("submitForm: AC-15/REQ-10 — persists the submission with field values, source IP, timestamp", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0]!.data, { name: "Ada", email: "ada@example.com" });
  assert.equal(page.items[0]!.sourceIp, "1.1.1.1");
  assert.equal(page.items[0]!.submittedAt, NOW);
});

test("submitForm: AC-11/REQ-07 — rejects a nonexistent slug with FormDefinitionNotFoundError", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      submitForm({
        deps,
        input: { workspaceId: WORKSPACE_ID, slug: "nope", body: {}, sourceIp: "1.1.1.1" },
      }),
    FormDefinitionNotFoundError
  );
});

test("submitForm: AC-12/REQ-07/EC-03 — rejects a disabled slug with the identical FormDefinitionNotFoundError", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition({ status: "disabled" }));
  await assert.rejects(
    () =>
      submitForm({
        deps,
        input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
      }),
    FormDefinitionNotFoundError
  );
});

test("submitForm: AC-08/09/10 — rejects an invalid payload with FormSubmissionValidationError, nothing persisted", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  await assert.rejects(
    () =>
      submitForm({
        deps,
        input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada" }, sourceIp: "1.1.1.1" },
      }),
    FormSubmissionValidationError
  );

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 0);
});

test("submitForm: AC-13/INV-04 — a honeypot-tripped submission returns accepted but persists nothing and enqueues nothing", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      slug: "contact",
      body: { name: "Ada", email: "ada@example.com", _hp: "i-am-a-bot" },
      sourceIp: "1.1.1.1",
    },
  });
  assert.equal(result.status, "accepted");

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 0);

  const claimed = await deps.outbox.claimPending(20, NOW);
  assert.equal(claimed.length, 0);
});

test("submitForm: EC-09 — a whitespace-only honeypot field is treated as normal (not tripped)", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      slug: "contact",
      body: { name: "Ada", email: "ada@example.com", _hp: "   " },
      sourceIp: "1.1.1.1",
    },
  });
  assert.equal(result.status, "accepted");

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 1);
});

test("submitForm: AC-14/REQ-09 — the 6th submission in-window from the same (ip, formId) is rate-limited", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const body = { name: "Ada", email: "ada@example.com" };

  for (let i = 0; i < 5; i++) {
    const result = await submitForm({
      deps,
      input: { workspaceId: WORKSPACE_ID, slug: "contact", body, sourceIp: "2.2.2.2" },
    });
    assert.equal(result.status, "accepted");
  }

  await assert.rejects(
    () => submitForm({ deps, input: { workspaceId: WORKSPACE_ID, slug: "contact", body, sourceIp: "2.2.2.2" } }),
    FormRateLimitExceededError
  );
});

test("submitForm: INV-07 — enqueues exactly one form.submission.received event per accepted submission", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const received: string[] = [];
  await deps.bus.subscribe({ eventName: "form.submission.received", handler: async (event) => {
    received.push(event.id);
  } });

  await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });

  // Give the fire-and-forget processOutbox call ( below) a tick to actually deliver. See docs/decisions/DR-001-anonymous-submission-containment.md.
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(received.length, 1);
});

test("submitForm: AC-24/INV-05 — the response resolves before a slow/throwing subscriber settles (fire-and-forget outbox drain)", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  let subscriberSettled = false;
  let releaseSubscriber: () => void = () => {};
  const hang = new Promise<void>((resolve) => {
    releaseSubscriber = resolve;
  });
  await deps.bus.subscribe({ eventName: "form.submission.received", handler: async () => {
    await hang;
    subscriberSettled = true;
    throw new Error("simulated slow/throwing MailerPort.send()");
  } });

  const result = await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "3.3.3.3" },
  });

  assert.equal(result.status, "accepted");
  assert.equal(subscriberSettled, false, "submitForm must not wait for the subscriber to settle");

  releaseSubscriber();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(subscriberSettled, true, "the subscriber eventually runs, just not before the response");
});

test("submitForm: the submission row and its event are written inside one host transaction, dispatch only after it", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const trace: string[] = [];
  let inTransaction = false;
  const create = deps.submissionRepo.create.bind(deps.submissionRepo);
  deps.submissionRepo.create = async (record) => { trace.push(`create:${inTransaction}`); await create(record); };
  const enqueue = deps.outbox.enqueue.bind(deps.outbox);
  deps.outbox.enqueue = async (event) => { trace.push(`enqueue:${inTransaction}`); await enqueue(event); };
  const dispatch = deps.dispatcher.dispatch.bind(deps.dispatcher);
  deps.dispatcher.dispatch = async () => { trace.push(`dispatch:${inTransaction}`); await dispatch(); };
  const transaction = async <T>(work: () => Promise<T>): Promise<T> => {
    inTransaction = true;
    try { return await work(); } finally { inTransaction = false; trace.push("commit"); }
  };

  await submitForm({ deps: { ...deps, transaction }, input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" } });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(trace, ["create:true", "enqueue:true", "commit", "dispatch:false"]);
});

test("submitForm: a failed enqueue rejects through the transaction and dispatches nothing", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  deps.outbox.enqueue = async () => { throw new Error("outbox unavailable"); };
  let dispatched = 0;
  deps.dispatcher.dispatch = async () => { dispatched++; };
  const rolledBack: unknown[] = [];
  const transaction = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) { rolledBack.push(error); throw error; }
  };

  await assert.rejects(
    () => submitForm({ deps: { ...deps, transaction }, input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" } }),
    { message: "outbox unavailable" },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(rolledBack.length, 1);
  assert.equal(dispatched, 0);
});

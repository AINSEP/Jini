import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { InMemoryEventBus } from "./eventing.fixture.js";
import type { DomainEvent } from "@jini-ai/cms/core";
import type { MailerPort, MailerSendOptions, MailerSendResult, OutboundEmail } from "../ports.js";
import { registerFormNotifySubscriber as registerSubscriber } from "../notify-subscriber.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./repo.fixture.js";
import type { FormDefinitionRecord, FormSubmissionRecord } from "../types.js";

const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";

class RecordingMailer implements MailerPort {
  readonly calls: Array<{ message: OutboundEmail; opts: MailerSendOptions }> = [];
  result: MailerSendResult = { ok: true, providerMessageId: "msg-1", acceptedAt: NOW };

  capabilities() {
    return { driver: "recording", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false };
  }
  async send({ message, options: opts }: { message: OutboundEmail; options: MailerSendOptions }): Promise<MailerSendResult> {
    this.calls.push({ message, opts });
    return this.result;
  }
  async sendBatch(messages: readonly OutboundEmail[], opts: MailerSendOptions) {
    const results: MailerSendResult[] = [];
    for (const m of messages) results.push(await this.send({ message: m, options: opts }));
    return results;
  }
}

function makeDefinition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "def-1",
    workspaceId: WORKSPACE_ID,
    name: "Contact",
    slug: "contact",
    fields: [{ id: "name", label: "Name", type: "text", required: true }],
    notify: { enabled: false, recipients: [] },
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord {
  return {
    id: "sub-1",
    workspaceId: WORKSPACE_ID,
    formDefinitionId: "def-1",
    data: { name: "Ada" },
    sourceIp: "127.0.0.1",
    submittedAt: NOW,
    ...overrides,
  };
}

function publishSubmissionEvent(bus: InMemoryEventBus, submissionId: string, formDefinitionId = "def-1") {
  const event: DomainEvent<{ workspaceId: string; formDefinitionId: string; submissionId: string }> = {
    id: `evt-${submissionId}`,
    name: "form.submission.received",
    occurredAt: NOW,
    workspaceId: WORKSPACE_ID,
    payload: { workspaceId: WORKSPACE_ID, formDefinitionId, submissionId },
  };
  return bus.publish(event);
}

test("registerFormNotifySubscriber: AC-17 — invokes MailerPort.send() for a notify-enabled definition with an idempotencyKey built from submissionId", async () => {
  const bus = new InMemoryEventBus();
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const mailer = new RecordingMailer();

  await definitionRepo.create(
    makeDefinition({ notify: { enabled: true, recipients: ["ops@example.com"] } })
  );
  await submissionRepo.create(makeSubmission());

  await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
  await publishSubmissionEvent(bus, "sub-1");

  assert.equal(mailer.calls.length, 1);
  assert.equal(mailer.calls[0]!.message.to.email, "ops@example.com");
  assert.ok(mailer.calls[0]!.opts.idempotencyKey.includes("sub-1"));
  assert.deepEqual(mailer.calls[0]!.message, {
    workspaceId: WORKSPACE_ID, to: { email: "ops@example.com" }, from: { email: "no-reply@forms.local", name: "Forms" },
    subject: "New submission: Contact", text: JSON.stringify({ name: "Ada" }),
  });
  assert.deepEqual(mailer.calls[0]!.opts, { idempotencyKey: "forms:notify:sub-1:ops@example.com", workspaceId: WORKSPACE_ID, sourceContext: { module: "forms", ref: "def-1" }, purpose: "transactional", lane: "notification" });
});

test("registerFormNotifySubscriber: AC-18 — never invokes MailerPort.send() when notify is disabled", async () => {
  const bus = new InMemoryEventBus();
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const mailer = new RecordingMailer();

  await definitionRepo.create(makeDefinition({ notify: { enabled: false, recipients: ["ops@example.com"] } }));
  await submissionRepo.create(makeSubmission());

  await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
  await publishSubmissionEvent(bus, "sub-1");

  assert.equal(mailer.calls.length, 0);
});

test("registerFormNotifySubscriber: invokes send() once per configured recipient", async () => {
  const bus = new InMemoryEventBus();
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const mailer = new RecordingMailer();

  await definitionRepo.create(
    makeDefinition({ notify: { enabled: true, recipients: ["a@example.com", "b@example.com"] } })
  );
  await submissionRepo.create(makeSubmission());

  await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
  await publishSubmissionEvent(bus, "sub-1");

  assert.equal(mailer.calls.length, 2);
  assert.deepEqual(
    mailer.calls.map((c) => c.message.to.email).sort(),
    ["a@example.com", "b@example.com"]
  );
  assert.deepEqual(mailer.calls.map((call) => call.opts.idempotencyKey).sort(), ["forms:notify:sub-1:a@example.com", "forms:notify:sub-1:b@example.com"]);
  await publishSubmissionEvent(bus, "sub-1");
  assert.equal(mailer.calls.length, 4);
  assert.deepEqual(mailer.calls.slice(2).map((call) => call.opts.idempotencyKey), mailer.calls.slice(0, 2).map((call) => call.opts.idempotencyKey));
});

test("registerFormNotifySubscriber: EC-06 — a SUPPRESSED mailer result is logged, not thrown, and does not crash the subscriber", async () => {
  const bus = new InMemoryEventBus();
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const mailer = new RecordingMailer();
  mailer.result = { ok: false, retryable: false, errorCode: "SUPPRESSED", message: "recipient suppressed" };

  await definitionRepo.create(
    makeDefinition({ notify: { enabled: true, recipients: ["ops@example.com"] } })
  );
  await submissionRepo.create(makeSubmission());

  await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
  // Should not throw / reject.
  await assert.doesNotReject(() => publishSubmissionEvent(bus, "sub-1"));
  assert.equal(mailer.calls.length, 1);
});

test("registerFormNotifySubscriber: a throwing MailerPort.send() is caught, never propagated into the bus", async () => {
  const bus = new InMemoryEventBus();
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const mailer = new RecordingMailer();
  mailer.send = async () => {
    throw new Error("provider is down");
  };

  await definitionRepo.create(
    makeDefinition({ notify: { enabled: true, recipients: ["ops@example.com"] } })
  );
  await submissionRepo.create(makeSubmission());

  await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
  await assert.doesNotReject(() => publishSubmissionEvent(bus, "sub-1"));
});

for (const scenario of ["missing definition", "missing submission", "empty recipients", "definition read fails", "submission read fails"] as const) {
  test(`registerFormNotifySubscriber: ${scenario} sends nothing and preserves sibling delivery`, async () => {
    const bus = new InMemoryEventBus();
    const definitionRepo = new InMemoryFormDefinitionRepo();
    const submissionRepo = new InMemoryFormSubmissionRepo();
    const mailer = new RecordingMailer();
    if (scenario !== "missing definition") await definitionRepo.create(makeDefinition({ notify: { enabled: true, recipients: scenario === "empty recipients" ? [] : ["ops@example.com"] } }));
    if (scenario !== "missing submission") await submissionRepo.create(makeSubmission());
    if (scenario === "definition read fails") vi.spyOn(definitionRepo, "findById").mockImplementation( async () => { throw new Error("definition read failed"); });
    if (scenario === "submission read fails") vi.spyOn(submissionRepo, "findById").mockImplementation( async () => { throw new Error("submission read failed"); });
    await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
    let siblingCalls = 0;
    await bus.subscribe({ eventName: "form.submission.received", handler: async () => { siblingCalls++; } });
    await assert.doesNotReject(() => publishSubmissionEvent(bus, "sub-1"));
    assert.equal(mailer.calls.length, 0);
    assert.equal(siblingCalls, 1);
  });
}

test("registerFormNotifySubscriber: unsubscribe stops later sends while sibling subscribers remain active", async () => {
  const bus = new InMemoryEventBus();
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const mailer = new RecordingMailer();
  await definitionRepo.create(makeDefinition({ notify: { enabled: true, recipients: ["ops@example.com"] } }));
  await submissionRepo.create(makeSubmission());
  const unsubscribe = await registerFormNotifySubscriber({ bus, mailer, formDefinitionRepo: definitionRepo, formSubmissionRepo: submissionRepo });
  let siblingCalls = 0;
  await bus.subscribe({ eventName: "form.submission.received", handler: async () => { siblingCalls++; } });
  await publishSubmissionEvent(bus, "sub-1");
  assert.equal(mailer.calls.length, 1);
  await unsubscribe();
  await publishSubmissionEvent(bus, "sub-1");
  assert.equal(mailer.calls.length, 1);
  assert.equal(siblingCalls, 2);
});

function registerFormNotifySubscriber(required: Omit<import("../notify-subscriber.js").RegisterFormNotifySubscriberDeps, "sender" | "logger">) { return registerSubscriber({ ...required, sender: { email: "no-reply@forms.local", name: "Forms" }, logger: { warn() {} } }); }

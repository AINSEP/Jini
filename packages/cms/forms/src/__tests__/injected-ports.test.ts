import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { submitForm } from "../submit-service.js";
import { registerFormNotifySubscriber } from "../notify-subscriber.js";
import { createFormDefinition, updateFormDefinition } from "../write-service.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./repo.fixture.js";
import { InMemoryChangeSetRepo } from "./change-set.fixture.js";
import { InMemoryEventBus, InMemoryOutbox } from "./eventing.fixture.js";
import { executeCommand } from "@jini-ai/cms/core";
import type { AuthorizeFn } from "@jini-ai/cms/core";
import { FormFieldValidationError } from "../errors.js";

function setup() {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const clock = { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z")};
  let id = 0;
  const idGen = { newId: () => `id-${++id}` };
  const writes = {
    repo: definitionRepo, clock, idGen, executeCommand, changeSets: new InMemoryChangeSetRepo(),
    authorize: vi.fn(async (_required: Parameters<AuthorizeFn>[0]) => ({ allowed: true, reason: "ok" })),
    permission: "tenant.forms.edit", reservedSlugs: new Set<string>(),
  };
  const input = { workspaceId: "workspace", actor: { id: "user", kind: "user" as const },
    name: "Contact", slug: "new", fields: [{ id: "name", label: "Name", type: "text" as const, required: true }] };
  const submitDeps = {
    definitionRepo, submissionRepo, clock, idGen, outbox: new InMemoryOutbox(),
    rateLimiter: { check: vi.fn(async (_required: { key: string }) => ({ allowed: true as const })) },
    dispatcher: { dispatch: vi.fn(async () => {}) }, logger: { warn: vi.fn() },
  };
  return { writes, input, submitDeps };
}

test("host permission and reserved slugs are injected; optional notify is stored", async () => {
  const { writes, input } = setup();
  const { definition } = await createFormDefinition({ deps: writes, input }, { notify: { enabled: true, recipients: ["ops@example.org"] } });
  assert.equal(definition.slug, "new");
  assert.deepEqual(definition.notify, { enabled: true, recipients: ["ops@example.org"] });
  assert.equal(writes.authorize.mock.calls.length, 1);
  assert.equal(writes.authorize.mock.calls[0]![0].permission, "tenant.forms.edit");
  const permissions: string[] = [];
  await updateFormDefinition({ deps: { ...writes, reservedSlugs: new Set(["host-only"]), authorize: async ({ permission }) => { permissions.push(permission); return { allowed: true, reason: "ok" }; } }, input: { workspaceId: "workspace", actor: input.actor, formId: definition.id, patch: { name: "Updated" } } });
  assert.deepEqual(permissions, ["tenant.forms.edit"]);
});

test("an injected command gateway can deny a write before persistence", async () => {
  const { writes, input } = setup();
  const error = new Error("host gateway denied mutation");
  // A rejecting gateway has no result; preserve that instead of specializing TResult in the mock.
  const gateway = vi.fn(async (_required: Parameters<typeof executeCommand>[0]): Promise<never> => { throw error; });
  await assert.rejects(createFormDefinition({ deps: { ...writes, executeCommand: gateway }, input }), (caught) => caught === error);
  assert.equal(gateway.mock.calls.length, 1);
  const command = gateway.mock.calls[0]![0];
  assert.equal(command.command.permission, "tenant.forms.edit");
  assert.equal(command.command.workspaceId, "workspace");
  assert.equal(command.mutation.entityType, "form_definition");
  assert.equal((await writes.repo.list({ workspaceId: "workspace" })).length, 0);
  assert.equal(writes.authorize.mock.calls.length, 0);
});

test("the same slug is accepted or refused solely by the host's reserved-slug policy", async () => {
  const treatment = setup();
  const baseline = setup();
  const accepted = await createFormDefinition({ deps: treatment.writes, input: treatment.input });
  assert.equal(accepted.definition.slug, "new");
  await assert.rejects(createFormDefinition({ deps: { ...baseline.writes, reservedSlugs: new Set(["new"]) }, input: baseline.input }), FormFieldValidationError);
  assert.equal((await baseline.writes.repo.list({ workspaceId: "workspace" })).length, 0);
  // Both runs receive the identical input; only the host's reservation set changes the outcome.
});

test("async rate limiter receives the composite key before persistence", async () => {
  const { writes, input, submitDeps } = setup();
  const { definition } = await createFormDefinition({ deps: writes, input });
  const keys: string[] = [];
  submitDeps.rateLimiter.check = vi.fn(async ({ key }: { key: string }) => { keys.push(key); return { allowed: true as const }; });
  await submitForm({ deps: submitDeps, input: { workspaceId: "workspace", slug: "new", body: { name: "Ada" }, sourceIp: "2001:db8::1" } });
  assert.deepEqual(keys, [`2001:db8::1:${definition.id}`]);
  assert.equal((await submitDeps.submissionRepo.listByDefinition({ workspaceId: "workspace", formDefinitionId: definition.id, limit: 10 })).items.length, 1);
});

test.each(["reject", "throw"])("background dispatcher may %s without rejecting submission", async (failure) => {
  const { writes, input, submitDeps } = setup();
  await createFormDefinition({ deps: writes, input });
  const error = new Error("dispatcher unavailable");
  const deps = { ...submitDeps, dispatcher: { dispatch: failure === "throw" ? () => { throw error; } : async () => { throw error; } } };
  assert.deepEqual(await submitForm({ deps, input: { workspaceId: "workspace", slug: "new", body: { name: "Ada" }, sourceIp: "source" } }), { status: "accepted" });
  await vi.waitFor(() => assert.equal(submitDeps.logger.warn.mock.calls.length, 1));
  assert.deepEqual(submitDeps.logger.warn.mock.calls[0], [{ message: "form outbox dispatch failed" }, { error }]);
});

test("injected sender is used and failed delivery still reaches the next recipient and sibling", async () => {
  const { writes, input, submitDeps } = setup();
  const { definition } = await createFormDefinition({ deps: writes, input }, { notify: { enabled: true, recipients: ["first@example.org", "second@example.org"] } });
  await submitForm({ deps: submitDeps, input: { workspaceId: "workspace", slug: "new", body: { name: "Ada" }, sourceIp: "source" } });
  const bus = new InMemoryEventBus();
  const send = vi.fn(async (required: { message: { from: { email: string }; to: { email: string } } }) => {
    if (required.message.to.email === "first@example.org") throw new Error("mail down");
    return { ok: true as const, providerMessageId: "message", acceptedAt: "now" };
  });
  const unsubscribe = await registerFormNotifySubscriber({ bus, mailer: { send }, sender: { email: "host@example.org" }, logger: { warn: () => { throw new Error("logging down"); } }, formDefinitionRepo: submitDeps.definitionRepo, formSubmissionRepo: submitDeps.submissionRepo });
  let siblingCalls = 0;
  await bus.subscribe({ eventName: "form.submission.received", handler: async () => { siblingCalls++; } });
  const event = submitDeps.outbox.events[0]!;
  await bus.publish(event);
  assert.equal(send.mock.calls.length, 2);
  assert.deepEqual(send.mock.calls.map(([args]) => args.message.from), [{ email: "host@example.org" }, { email: "host@example.org" }]);
  assert.equal(siblingCalls, 1);
  assert.equal(event.payload.formDefinitionId, definition.id);
  await unsubscribe();
  await bus.publish(event);
  assert.equal(send.mock.calls.length, 2);
  assert.equal(siblingCalls, 2);
});

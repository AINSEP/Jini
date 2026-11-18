import assert from "node:assert/strict";
import { test } from "vitest";
import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { executeCommand } from "../../core/index.js";
import { DELIVERY_STATUS_MAX_LIMIT } from "../delivery-status-limits.js";
import { FormDefinitionNotFoundError } from "../errors.js";
import { duplicateFormDefinition } from "../duplicate-form.js";
import { formsAgentToolCatalog } from "../agent-tools.js";
import type { FormsPackageToolDeps, FormsToolDeliveryStatusRow, FormsToolWriteDeps, FormsWriteOps } from "../tool-handlers.types.js";
import { buildFormsToolRegistrations, formsDerivedRisk } from "../tool-registrations.js";
import {
  type FormWriteServiceDeps,
  createFormDefinition,
  setFormDefinitionStatus,
  updateFormDefinition,
} from "../write-service.js";
import type { FieldDescriptor } from "../types.js";
import { InMemoryChangeSetRepo } from "./change-set.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./repo.fixture.js";

const WORKSPACE_ID = "ws-1";
const PRINCIPAL_ID = "principal-1";
const FIELDS: FieldDescriptor[] = [{ id: "email", type: "email", label: "Email", required: true }];
const TOOL_IDS = [
  "forms_list_providers",
  "forms_list_definitions",
  "forms_create_definition",
  "forms_update_definition",
  "forms_set_definition_status",
  "forms_list_submissions",
  "forms_get_submission",
  "forms_delivery_status",
  "forms_pull_submissions",
];

interface Fixture {
  deps: FormsPackageToolDeps;
  repo: InMemoryFormDefinitionRepo;
  submissions: InMemoryFormSubmissionRepo;
  allow: { value: boolean };
  writeCalls: string[];
  pulls: Array<{ workspaceId: string; targetId?: string }>;
}

/** The host's wrappers are faked as the package writes with the host's permission and reserved slugs bound. */
function makeWrites(writeCalls: string[]): FormsWriteOps {
  const bind = (deps: FormsToolWriteDeps): FormWriteServiceDeps => ({ ...deps, permission: "admin.forms.manage", reservedSlugs: new Set(["new"]) });
  return {
    create: ({ deps, input }) => { writeCalls.push("create"); return createFormDefinition({ deps: bind(deps), input }); },
    update: ({ deps, input }, optional = {}) => { writeCalls.push("update"); return updateFormDefinition({ deps: bind(deps), input }, optional); },
    setStatus: ({ deps, input }) => { writeCalls.push("setStatus"); return setFormDefinitionStatus({ deps: bind(deps), input }); },
  } as FormsWriteOps;
}

function makeFixture(): Fixture {
  let counter = 0;
  const repo = new InMemoryFormDefinitionRepo();
  const submissions = new InMemoryFormSubmissionRepo();
  const allow = { value: true };
  const writeCalls: string[] = [];
  const pulls: Fixture["pulls"] = [];
  const deps: FormsPackageToolDeps = {
    workspaceId: WORKSPACE_ID,
    executeCommand,
    clock: { nowMs: () => Date.parse("2026-11-18T00:00:00.000Z") },
    idGen: { newId: () => `id-${++counter}` },
    authorize: async () => (allow.value ? { allowed: true, reason: "matched" } : { allowed: false, reason: "insufficient_permission" }),
    changeSets: new InMemoryChangeSetRepo(),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } as unknown as FormsPackageToolDeps["outbox"],
    formDefinitionRepo: repo,
    formSubmissionRepo: submissions,
    formWrites: makeWrites(writeCalls),
    slugPolicy: { slugify: (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), maxAttempts: 20, reservedSlugs: new Set(["new"]) },
    deriveDuplicateName: async ({ sourceName }, { isTaken }) => {
      for (let suffix = 2; suffix < 50; suffix++) if (!(await isTaken({ candidate: `${sourceName} ${suffix}` }))) return `${sourceName} ${suffix}`;
      throw new Error("no free name");
    },
    formSubmissionsPull: { pull: async (required, optional = {}) => { pulls.push({ ...required, ...optional }); return { ran: true }; } },
  };
  return { deps, repo, submissions, allow, writeCalls, pulls };
}

function ctx(input: unknown): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

function caller(registrations: ToolRegistration[]) {
  return (id: string, input: unknown): Promise<unknown> => {
    const found = registrations.find((registration) => registration.descriptor.id === id);
    assert.ok(found, `expected '${id}' to be wired`);
    return Promise.resolve(found.handler(ctx(input)));
  };
}

function build(fixture: Fixture) {
  return caller(buildFormsToolRegistrations({ deps: fixture.deps }));
}

async function seedForm(fixture: Fixture): Promise<string> {
  const { definition } = await fixture.deps.formWrites.create({
    deps: { ...fixture.deps, repo: fixture.repo },
    input: { workspaceId: WORKSPACE_ID, actor: { id: PRINCIPAL_ID, kind: "user" }, name: "Contact", slug: "contact", fields: FIELDS },
  });
  fixture.writeCalls.length = 0;
  return definition.id;
}

test("the nine forms tools are wired in catalog order with their authored risk", () => {
  const registrations = buildFormsToolRegistrations({ deps: makeFixture().deps });
  assert.deepEqual(registrations.map((registration) => registration.descriptor.id), TOOL_IDS);
  assert.deepEqual(formsAgentToolCatalog.map((entry) => entry.name).sort(), [...TOOL_IDS].sort());
  assert.deepEqual([...formsDerivedRisk.keys()].sort(), [...TOOL_IDS].sort());
  assert.equal(formsDerivedRisk.get("forms_pull_submissions"), "mutates-durable-state");
  assert.equal(formsDerivedRisk.get("forms_delivery_status"), "none");
});

test("every tool refuses a principal without the permission", async () => {
  const fixture = makeFixture();
  const formId = await seedForm(fixture);
  const call = build(fixture);
  fixture.allow.value = false;
  const inputs: Record<string, unknown> = {
    forms_list_providers: {},
    forms_list_definitions: {},
    forms_create_definition: { name: "N", slug: "n", fields: FIELDS },
    forms_update_definition: { formId, expectedVersion: 1, name: "N2" },
    forms_set_definition_status: { formId, status: "disabled" },
    forms_list_submissions: { formId },
    forms_get_submission: { formId, submissionId: "s-1" },
    forms_delivery_status: {},
    forms_pull_submissions: {},
  };
  for (const id of TOOL_IDS) {
    await assert.rejects(call(id, inputs[id]), /FORMS_FORBIDDEN: .*not authorized/, id);
  }
});

test("create, update and set-status go through the host's write wrappers and return the model-facing view", async () => {
  const fixture = makeFixture();
  const call = build(fixture);
  const created = (await call("forms_create_definition", { name: "Contact", slug: "contact", fields: FIELDS })) as { definition: Record<string, unknown> };
  assert.deepEqual(Object.keys(created.definition).sort(), ["fields", "id", "name", "notify", "slug", "status", "version"]);
  const formId = created.definition.id as string;
  const updated = (await call("forms_update_definition", { formId, expectedVersion: 1, name: "Contact us" })) as { definition: { name: string; version: number } };
  assert.equal(updated.definition.name, "Contact us");
  const disabled = (await call("forms_set_definition_status", { formId, status: "disabled" })) as { definition: { status: string } };
  assert.equal(disabled.definition.status, "disabled");
  assert.deepEqual(fixture.writeCalls, ["create", "update", "setStatus"]);
});

test("an update without the expected version, an empty patch and a bad status are refused with the schema", async () => {
  const fixture = makeFixture();
  const formId = await seedForm(fixture);
  const call = build(fixture);
  await assert.rejects(call("forms_update_definition", { formId, name: "N" }), (error: Error) => error instanceof ToolInputError && /expectedVersion/.test(error.message));
  await assert.rejects(call("forms_update_definition", { formId, expectedVersion: 1 }), /at least one of 'name', 'fields', or 'notify'/);
  await assert.rejects(call("forms_set_definition_status", { formId, status: "gone" }), /'status' must be exactly 'active' or 'disabled'/);
  assert.deepEqual(fixture.writeCalls, []);
});

test("list definitions drops the html body and reads the repo through the workspace", async () => {
  const fixture = makeFixture();
  await seedForm(fixture);
  const result = (await build(fixture)("forms_list_definitions", {})) as { definitions: Array<{ slug: string; html?: string }> };
  assert.deepEqual(result.definitions.map((definition) => definition.slug), ["contact"]);
  assert.equal("html" in result.definitions[0]!, false);
});

test("a submission read answers not-found for another form's submission and bounds the page limit", async () => {
  const fixture = makeFixture();
  const formId = await seedForm(fixture);
  await fixture.submissions.create({ id: "s-1", workspaceId: WORKSPACE_ID, formDefinitionId: "other-form", data: { email: "a@b.test" }, sourceIp: "127.0.0.1", submittedAt: "2026-11-18T00:00:00.000Z" } as never);
  const call = build(fixture);
  await assert.rejects(call("forms_get_submission", { formId, submissionId: "s-1" }), /submission 's-1' was not found/);
  await assert.rejects(call("forms_list_submissions", { formId: "missing" }), /FORMS_DEFINITION_NOT_FOUND/);
  await assert.rejects(call("forms_list_submissions", { formId, limit: 101 }), /'limit' must be an integer between 1 and 100/);
});

test("delivery status refuses a limit above the cap and reports when the port is absent", async () => {
  const fixture = makeFixture();
  const call = build(fixture);
  await assert.rejects(call("forms_delivery_status", {}), /Form delivery status is not available/);
  const row = { bindingId: "b1", adapterId: "a1", formId: "f1", submissionId: "s1", status: "pending", attempts: 0, nextRetryAt: null, errorCode: null, extra: "never reported" };
  fixture.deps.formDeliveryStatus = {
    forSubmission: async () => [row as unknown as FormsToolDeliveryStatusRow],
    recentUnfinished: async () => [],
  };
  await assert.rejects(call("forms_delivery_status", { limit: DELIVERY_STATUS_MAX_LIMIT + 1 }), new RegExp(`between 1 and ${DELIVERY_STATUS_MAX_LIMIT}`));
  const reported = (await call("forms_delivery_status", { submissionId: "s1" })) as { deliveries: Array<Record<string, unknown>> };
  assert.equal("extra" in reported.deliveries[0]!, false);
});

test("pull passes the workspace and the optional target to the host port, and reports a missing port", async () => {
  const fixture = makeFixture();
  const call = build(fixture);
  await call("forms_pull_submissions", { targetId: "t1" });
  await call("forms_pull_submissions", {});
  assert.deepEqual(fixture.pulls, [{ workspaceId: WORKSPACE_ID, targetId: "t1" }, { workspaceId: WORKSPACE_ID }]);
  delete fixture.deps.formSubmissionsPull;
  await assert.rejects(call("forms_pull_submissions", {}), /Pulling form submissions is not available/);
});

test("duplicating a form picks the next free name and slug, keeps a disabled source disabled and refuses a status override", async () => {
  const fixture = makeFixture();
  const formId = await seedForm(fixture);
  const input = (overrides: { title?: string; slug?: string; status?: string }) => ({ principalId: PRINCIPAL_ID, id: formId, overrides });
  const first = (await duplicateFormDefinition({ deps: fixture.deps, input: input({}) })) as { definition: { name: string; slug: string; status: string } };
  assert.deepEqual([first.definition.name, first.definition.slug, first.definition.status], ["Contact 2", "contact-2", "active"]);
  await fixture.deps.formWrites.setStatus({ deps: { ...fixture.deps, repo: fixture.repo }, input: { workspaceId: WORKSPACE_ID, actor: { id: PRINCIPAL_ID, kind: "user" }, formId, status: "disabled" } });
  const second = (await duplicateFormDefinition({ deps: fixture.deps, input: input({}) })) as { definition: { name: string; status: string } };
  assert.deepEqual([second.definition.name, second.definition.status], ["Contact 3", "disabled"]);
  await assert.rejects(duplicateFormDefinition({ deps: fixture.deps, input: input({ status: "draft" }) }), /does not support the 'status' override/);
  await assert.rejects(duplicateFormDefinition({ deps: fixture.deps, input: { ...input({}), id: "missing" } }), FormDefinitionNotFoundError);
});

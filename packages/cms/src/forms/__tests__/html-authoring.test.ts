import { toDefinitionRecord, toDefinitionRow, type FormDefinitionRow } from "../sql/repo.rows.js";
import type { RateLimiterPort } from "../index.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { ForbiddenError } from "../../core/index.js";
import { FormSubmissionValidationError, FormRateLimitExceededError } from "../index.js";
import { executeCommand, InMemoryChangeSetRepo } from "./support/host-ports.fixture.js";
import { InMemoryEventBus, InMemoryOutbox } from "./eventing.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./support/repo-ports.fixture.js";
import { createFormDefinition, updateFormDefinition } from "./support/host-ports.fixture.js";
import { deriveHtmlForm, decodeFormFields, encodeFormFields, type HtmlFormDefinitionRecord } from "../html/html-authoring.js";
import { submitForm } from "./support/host-ports.fixture.js";

/** Owner acceptance 2026-10-04: authored names are the durable submission allowlist. Not run by dispatch. */
function harness() {
  const repo = new InMemoryFormDefinitionRepo();
  let counter = 0;
  const clock = { nowMs: () => Date.parse("2026-10-04T12:00:00Z") };
  const idGen = { newId: () => `html-${++counter}` };
  const writeDeps = { repo, clock, idGen, executeCommand, changeSets: new InMemoryChangeSetRepo(), authorize: async () => ({ allowed: true, reason: "ok" }) };
  const submissions = new InMemoryFormSubmissionRepo();
  const submitDeps = { definitionRepo: repo, submissionRepo: submissions, clock, idGen, outbox: new InMemoryOutbox(), bus: new InMemoryEventBus(), rateLimiter: { check: async (_required: { key: string }) => ({ allowed: true }) } as RateLimiterPort };
  return { repo, submissions, writeDeps, submitDeps };
}
const target = { workspaceId: "ws", actor: { id: "owner", kind: "user" as const } };

test("HTML save ignores caller fields, derives names, strips outer transport, preserves trusted script", async () => {
  const { writeDeps } = harness();
  const { definition } = await createFormDefinition({ deps: writeDeps, input: {
    ...target, name: "Contact", slug: "contact", mode: "html", fields: [],
    html: `<form action="https://elsewhere.invalid" method="get"><!-- <input name="fake"> --><label>Email<input name="email" type="email" required></label><script>window.example = '<input name="fake">';</script><button formaction="https://elsewhere.invalid" formmethod="get" name="send">Send</button></form>`,
  } });
  const authored = definition as HtmlFormDefinitionRecord;
  assert.deepEqual(authored.fields, [{ id: "email", label: "Email", type: "email", required: true }]);
  assert.equal(authored.mode, "html");
  assert.doesNotMatch(authored.html!, /<form\b|formaction=|formmethod=|name="send"/);
  assert.match(authored.html!, /<script>window.example/);
  assert.deepEqual(decodeFormFields({ json: encodeFormFields({ definition: authored }) }), { fields: authored.fields, mode: "html", html: authored.html });
  assert.deepEqual(decodeFormFields({ json: JSON.stringify(authored.fields) }), { fields: authored.fields });
  assert.deepEqual(toDefinitionRecord(toDefinitionRow(authored) as FormDefinitionRow), authored);
});

test("HTML edits replace removed names; submission accepts current columns and rejects old/unknown names", async () => {
  const { writeDeps, submitDeps, submissions, repo } = harness();
  const { definition } = await createFormDefinition({ deps: writeDeps, input: { ...target, name: "Contact", slug: "contact", mode: "html", fields: [], html: '<input name="old">' } });
  await updateFormDefinition({ deps: writeDeps, input: { ...target, formId: definition.id, patch: { mode: "html", html: '<input type="email" name="email" required>' } } });
  assert.deepEqual((await repo.findById({ workspaceId: "ws", id: definition.id }))?.fields.map((field) => field.id), ["email"]);
  const input = { workspaceId: "ws", slug: "contact", sourceIp: "127.0.0.1", body: { email: "ada@example.com" } };
  assert.deepEqual(await submitForm({ deps: submitDeps, input }), { status: "accepted" });
  await assert.rejects(submitForm({ deps: submitDeps, input: { ...input, body: { email: "ada@example.com", old: "unregistered" } } }), FormSubmissionValidationError);
  await assert.rejects(submitForm({ deps: submitDeps, input: { ...input, body: {} } }), FormSubmissionValidationError);
  const page = await submissions.listByDefinition({ workspaceId: "ws", formDefinitionId: definition.id, limit: 10 });
  assert.deepEqual(page.items.map((row) => row.data), [{ email: "ada@example.com" }]);
});

test("honeypot silently rejects persistence and notifications; existing limiter still rejects a real submission", async () => {
  const { writeDeps, submitDeps, submissions } = harness();
  const { definition } = await createFormDefinition({ deps: writeDeps, input: { ...target, name: "Contact", slug: "contact", mode: "html", fields: [], html: '<input name="email" type="email" required>' } });
  let checks = 0;
  submitDeps.rateLimiter.check = async () => { checks++; return { allowed: false, retryAfterSeconds: 12 }; };
  const input = { workspaceId: "ws", slug: "contact", sourceIp: "127.0.0.1", body: { _hp: "bot" } };
  assert.deepEqual(await submitForm({ deps: submitDeps, input }), { status: "accepted" });
  assert.equal(checks, 0);
  assert.equal((await submissions.listByDefinition({ workspaceId: "ws", formDefinitionId: definition.id, limit: 10 })).items.length, 0);
  await assert.rejects(submitForm({ deps: submitDeps, input: { ...input, body: { email: "ada@example.com" } } }), FormRateLimitExceededError);
  assert.equal(checks, 1);
});

test("HTML authoring requires raw-HTML permission even when forms.manage is allowed", async () => {
  const { writeDeps, repo } = harness();
  const deps = { ...writeDeps, authorize: async ({ permission }: { permission: string }) => ({ allowed: permission !== "pages.edit_html", reason: "editor role" }) };
  await assert.rejects(createFormDefinition({ deps, input: { ...target, name: "Contact", slug: "contact", mode: "html", fields: [], html: '<input name="email">' } }), ForbiddenError);
  assert.deepEqual(await repo.list({ workspaceId: "ws" }), []);
});

test("reserved names and multi-valued/file controls cannot become scalar submission columns", () => {
  for (const html of ['<input name="_hp">', '<input name="constructor">', '<input name="document" type="file">', '<select name="many" multiple></select>']) {
    assert.throws(() => deriveHtmlForm({ html }));
  }
});


test("malformed outer closers cannot terminate the server wrapper; authored checkbox values survive", () => {
  const authored = deriveHtmlForm({ html: '</form><label>Accept<input type="checkbox" name="accept" value="yes"></label>' });
  assert.doesNotMatch(authored.html, /<\/form>/);
  assert.match(authored.html, /value="yes"/);
  assert.ok(authored.fields[0]);
  assert.equal(authored.fields[0].type, "checkbox");
});

import assert from "node:assert/strict";
import { test } from "vitest";
import { deriveHtmlForm } from "../html/html-authoring.js";
import { createFormDefinition } from "./support/host-ports.fixture.js";
import { submitForm } from "./support/host-ports.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./support/repo-ports.fixture.js";
import { executeCommand, InMemoryChangeSetRepo } from "./support/host-ports.fixture.js";
import { InMemoryEventBus, InMemoryOutbox } from "./eventing.fixture.js";
import { FormSubmissionValidationError } from "../index.js";

test("HTML save and submission preserve authored checkbox strings, including empty/on; default remains true", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const submissions = new InMemoryFormSubmissionRepo();
  let id = 0;
  const clock = { nowMs: () => 1_000 };
  const idGen = { newId: () => `checkbox-${++id}` };
  const outbox = new InMemoryOutbox();
  const { definition } = await createFormDefinition({ deps: {
    repo, clock, idGen, executeCommand, changeSets: new InMemoryChangeSetRepo(), authorize: async () => ({ allowed: true, reason: "owner" }),
  }, input: { workspaceId: "ws", actor: { id: "owner", kind: "user" }, name: "Consent", slug: "consent", mode: "html", fields: [],
    html: '<label>Consent<input type="checkbox" name="consent" value="yes" required></label><input type="checkbox" name="native"><input type="checkbox" name="empty" value=""><input type="checkbox" name="onvalue" value="on">',
  } });
  const stored = await repo.findById({ workspaceId: "ws", id: definition.id });
  assert.match((stored as { html?: string })?.html ?? "", /value="yes"/);
  assert.match((stored as { html?: string })?.html ?? "", /value="yes" required>/);
  const deps = { definitionRepo: repo, submissionRepo: submissions, clock, idGen, outbox, bus: new InMemoryEventBus(), rateLimiter: { check: async () => ({ allowed: true as const }) } };
  const input = { workspaceId: "ws", slug: "consent", sourceIp: "127.0.0.1", body: { consent: "yes", native: "on", empty: "", onvalue: "on" } };
  await submitForm({ deps, input });
  const page = await submissions.listByDefinition({ workspaceId: "ws", formDefinitionId: definition.id, limit: 10 });
  assert.ok(page.items[0]);
  assert.deepEqual(page.items[0].data,
    { consent: "yes", native: true, empty: "", onvalue: "on" });
  await assert.rejects(submitForm({ deps, input: { ...input, body: {} } }), FormSubmissionValidationError);
  const authored = deriveHtmlForm({ html: '<input type="checkbox" name="consent" value="yes">' });
  assert.ok(authored.fields[0]);
  assert.equal(authored.fields[0].type, "checkbox");
});

test("required syntax remains authored, and control-looking strings inside scripts are untouched", () => {
  const html = '<input name="first" required><input name="second" REQUIRED=required><script>const example = \'<input name="fake" required="">\';</script>';
  const authored = deriveHtmlForm({ html });
  assert.match(authored.html, /name="first" required>/);
  assert.match(authored.html, /name="second" REQUIRED=required>/);
  assert.match(authored.html, /<script>const example = '<input name="fake" required="">';<\/script>/);
  assert.deepEqual(authored.fields.map((field) => field.id), ["first", "second"]);
});

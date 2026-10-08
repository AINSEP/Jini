import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryFormDefinitionRepo } from "../../../forms/repo.memory.js";
import type { FormDefinitionRecord } from "../../../forms/index.js";
import { createContactFormResolver } from "../../resolvers/index.js";
import type { WidgetInstanceView, WidgetResolveContext } from "../../types.js";

/**
 * @file `contact-form` widget resolver (SPEC-043 REQ-36..39) — direct unit coverage of
 * `createContactFormResolver`'s own branches. `resolve-html-page-embeds.integration.test.ts`
 * already exercises the happy path and the "disabled definition" degrade through the full
 * `resolveHtmlPageEmbeds` pipeline; this file adds the two branches that pipeline doesn't reach on
 * its own: a missing/invalid `formDefinitionId` in the instance config, a definition that is not
 * FOUND at all (as opposed to found-but-disabled), and the optional `successMessage` passthrough.
 */

const WORKSPACE_ID = "ws-1";
const CTX: WidgetResolveContext = { workspaceId: WORKSPACE_ID, preview: false };

function instance(overrides: Partial<WidgetInstanceView> & Pick<WidgetInstanceView, "id">): WidgetInstanceView {
  return { widgetType: "contact-form", config: {}, ...overrides };
}

function definition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "form-1",
    workspaceId: WORKSPACE_ID,
    name: "Contact",
    slug: "contact",
    fields: [],
    notify: { enabled: false, recipients: [] },
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("REQ-38: a config with no formDefinitionId resolves invalid-config, never calls the repo", async (t) => {
  const repo = new InMemoryFormDefinitionRepo();
  const byId = t.mock.method(repo, "findById");
  const bySlug = t.mock.method(repo, "findBySlug");
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: {} })], CTX);

  const result = results.get("w-1");
  assert.deepEqual(result, { ok: false, reason: "invalid-config" });
  assert.equal(byId.mock.callCount(), 0);
  assert.equal(bySlug.mock.callCount(), 0);
});

test("REQ-38: a non-string formDefinitionId resolves invalid-config", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany(
    [instance({ id: "w-1", config: { formDefinitionId: 42 } })],
    CTX,
  );

  const result = results.get("w-1");
  assert.deepEqual(result, { ok: false, reason: "invalid-config" });
});

test("REQ-38/EC-05: a formDefinitionId that resolves to no definition at all degrades to target-disabled, same as a disabled one", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany(
    [instance({ id: "w-1", config: { formDefinitionId: "does-not-exist" } })],
    CTX,
  );

  const result = results.get("w-1");
  assert.deepEqual(result, { ok: false, reason: "target-disabled" });
});

test("REQ-37: an active definition's successMessage config, when a string, is passed through in the resolved IR props", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  const fields: FormDefinitionRecord["fields"] = [
    { id: "email", label: "Reply address", type: "email", required: true, maxLength: 120 },
    { id: "message", label: "Your message", type: "textarea", required: true, maxLength: 900, className: "message-input" },
    { id: "consent", label: "Contact me", type: "checkbox", required: false },
  ];
  await repo.create(definition({ fields, version: 1 }));
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany(
    [instance({ id: "w-1", config: { formDefinitionId: "form-1", successMessage: "Thanks!" } })],
    CTX,
  );

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  assert.equal(result.ir.props.successMessage, "Thanks!");
  assert.deepEqual(result.ir.props.fields, fields);
  assert.equal(result.ir.props.formDefinitionId, "form-1");
  assert.equal(result.ir.props.slug, "contact");
  assert.deepEqual(result.dependencyKeys, ["form-1"]);
});

test("REQ-37: an active definition with no successMessage config resolves successMessage: null, not undefined", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  await repo.create(definition());
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany(
    [instance({ id: "w-1", config: { formDefinitionId: "form-1" } })],
    CTX,
  );

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  assert.equal(result.ir.props.successMessage, null);
});

test("REQ-38: a form id in another workspace degrades to target-disabled", async () => {
  const repo = new InMemoryFormDefinitionRepo();
  await repo.create(definition({ workspaceId: "other-workspace" }));
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });
  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "form-1" } })], CTX);
  assert.deepEqual(results.get("w-1"), { ok: false, reason: "target-disabled" });
});

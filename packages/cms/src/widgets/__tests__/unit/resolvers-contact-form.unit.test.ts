import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryFormDefinitionRepo } from "../../../forms/repo.memory.js";
import type { FormDefinitionRecord } from "../../../forms/index.js";
import { createContactFormResolver } from "../../resolvers/index.js";
import type { FormDefinitionReadPort, FormDefinitionView } from "../../resolvers/ports.js";
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

/** A typed read-port fake that records every lookup, so tests can assert which lookups ran. */
function recordingRepo(required: { byId?: readonly FormDefinitionView[]; bySlug?: readonly FormDefinitionView[] }): FormDefinitionReadPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findById({ workspaceId, id }) {
      calls.push(`id:${workspaceId}:${id}`);
      return required.byId?.find((view) => view.id === id) ?? null;
    },
    async findBySlug({ workspaceId, slug }) {
      calls.push(`slug:${workspaceId}:${slug}`);
      return required.bySlug?.find((view) => view.slug === slug) ?? null;
    },
  };
}

function view(overrides: Partial<FormDefinitionView> = {}): FormDefinitionView {
  return { id: "form-1", slug: "contact", status: "active", fields: [], ...overrides };
}

test("REQ-38: a formDefinitionRef alone is tried as an id first, then as the authored slug", async () => {
  const repo = recordingRepo({ bySlug: [view({ id: "form-9", slug: "contact" })] });
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionRef: "contact" } })], CTX);

  assert.deepEqual(repo.calls, ["id:ws-1:contact", "slug:ws-1:contact"]);
  assert.deepEqual(results.get("w-1"), {
    ok: true,
    ir: { componentId: "contact-form", props: { formDefinitionId: "form-9", slug: "contact", fields: [], successMessage: null } },
    dependencyKeys: ["form-9"],
  });
});

test("REQ-38: a formDefinitionRef found by id never falls back to the slug lookup", async () => {
  const repo = recordingRepo({ byId: [view({ id: "form-1" })] });
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionRef: "form-1" } })], CTX);

  assert.deepEqual(repo.calls, ["id:ws-1:form-1"]);
  assert.equal(results.get("w-1")?.ok, true);
});

test("REQ-38: with both keys, formDefinitionId is looked up by id and formDefinitionRef is the slug fallback", async () => {
  const repo = recordingRepo({ bySlug: [view({ id: "form-2", slug: "contact" })] });
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "gone", formDefinitionRef: "contact" } })], CTX);

  assert.deepEqual(repo.calls, ["id:ws-1:gone", "slug:ws-1:contact"]);
  assert.deepEqual(results.get("w-1"), {
    ok: true,
    ir: { componentId: "contact-form", props: { formDefinitionId: "form-2", slug: "contact", fields: [], successMessage: null } },
    dependencyKeys: ["form-2"],
  });
});

test("REQ-38: a formDefinitionId that misses with no formDefinitionRef never tries a slug lookup", async () => {
  const repo = recordingRepo({});
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "gone" } })], CTX);

  assert.deepEqual(repo.calls, ["id:ws-1:gone"]);
  assert.deepEqual(results.get("w-1"), { ok: false, reason: "target-disabled" });
});

test("REQ-38: a formDefinitionRef matching neither an id nor a slug degrades to target-disabled", async () => {
  const resolver = createContactFormResolver({ formDefinitionRepo: recordingRepo({}) });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionRef: "missing" } })], CTX);

  assert.deepEqual(results.get("w-1"), { ok: false, reason: "target-disabled" });
});

test("REQ-38: empty-string keys on both sides are invalid-config", async () => {
  const repo = recordingRepo({});
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "", formDefinitionRef: "" } })], CTX);

  assert.deepEqual(results.get("w-1"), { ok: false, reason: "invalid-config" });
  assert.deepEqual(repo.calls, []);
});

test("REQ-38: an empty-string formDefinitionId is still sent to findById before the formDefinitionRef slug fallback", async () => {
  const repo = recordingRepo({ bySlug: [view({ slug: "contact" })] });
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "", formDefinitionRef: "contact" } })], CTX);

  assert.deepEqual(repo.calls, ["id:ws-1:", "slug:ws-1:contact"]);
  assert.equal(results.get("w-1")?.ok, true);
});

test("REQ-38/EC-05: a found but non-active definition degrades to target-disabled", async () => {
  const resolver = createContactFormResolver({ formDefinitionRepo: recordingRepo({ byId: [view({ status: "disabled" })] }) });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "form-1" } })], CTX);

  assert.deepEqual(results.get("w-1"), { ok: false, reason: "target-disabled" });
});

test("REQ-37: an html-mode definition adds mode and its html to the props", async () => {
  const resolver = createContactFormResolver({ formDefinitionRepo: recordingRepo({ byId: [view({ mode: "html", html: "<form></form>" })] }) });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "form-1" } })], CTX);

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  assert.deepEqual(result.ir.props, { formDefinitionId: "form-1", slug: "contact", fields: [], mode: "html", html: "<form></form>", successMessage: null });
});

test("REQ-37: an html-mode definition with null html renders an empty html string", async () => {
  const resolver = createContactFormResolver({ formDefinitionRepo: recordingRepo({ byId: [view({ mode: "html", html: null })] }) });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "form-1" } })], CTX);

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  assert.equal(result.ir.props.html, "");
});

test("REQ-37: a non-html mode definition carries neither mode nor html in the props", async () => {
  const resolver = createContactFormResolver({ formDefinitionRepo: recordingRepo({ byId: [view({ mode: "fields", html: "<p>ignored</p>" })] }) });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "form-1" } })], CTX);

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.ir.props), ["formDefinitionId", "slug", "fields", "successMessage"]);
});

test("REQ-37: a non-string successMessage config resolves successMessage: null", async () => {
  const resolver = createContactFormResolver({ formDefinitionRepo: recordingRepo({ byId: [view()] }) });

  const results = await resolver.resolveMany([instance({ id: "w-1", config: { formDefinitionId: "form-1", successMessage: 7 } })], CTX);

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  assert.equal(result.ir.props.successMessage, null);
});

test("REQ-38: one batch isolates each instance's outcome by instance id", async () => {
  const repo = recordingRepo({ byId: [view()] });
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([
    instance({ id: "bad", config: {} }),
    instance({ id: "good", config: { formDefinitionId: "form-1" } }),
    instance({ id: "gone", config: { formDefinitionId: "missing" } }),
  ], CTX);

  assert.deepEqual([...results.keys()], ["bad", "good", "gone"]);
  assert.deepEqual(results.get("bad"), { ok: false, reason: "invalid-config" });
  assert.equal(results.get("good")?.ok, true);
  assert.deepEqual(results.get("gone"), { ok: false, reason: "target-disabled" });
});

test("REQ-38: an empty batch resolves an empty map without touching the repo", async () => {
  const repo = recordingRepo({});
  const resolver = createContactFormResolver({ formDefinitionRepo: repo });

  const results = await resolver.resolveMany([], CTX);

  assert.equal(results.size, 0);
  assert.deepEqual(repo.calls, []);
});

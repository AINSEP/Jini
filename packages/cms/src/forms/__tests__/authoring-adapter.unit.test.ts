import assert from "node:assert/strict";
import { test } from "vitest";
import { ForbiddenError } from "../../core/index.js";
import { FormFieldValidationError, type FormDefinitionRecord, type FormDefinitionRepoPort } from "../index.js";
import { prepareFormAuthoring, withFormAuthoring } from "./support/host-ports.fixture.js";
import { htmlSubmissionDefinition } from "../html/html-submission-adapter.js";
import type { HtmlFormDefinitionRecord } from "../html/html-authoring.js";
import type { FormWriteServiceDeps } from "../write-service.js";

// Direct tests for the two form host adapters: the authoring trust boundary (raw-HTML authority is
// checked before any parsing) and the HTML checkbox submission compatibility shim.
type AuthorizeInput = { principalId: string; permission: string; workspaceId: string };
function deps(allowed = true) {
  const calls: AuthorizeInput[] = [];
  const value = { authorize: async (input: AuthorizeInput) => { calls.push(input); return allowed ? { allowed: true } : { allowed: false, reason: "role_lacks_permission" }; } } as unknown as FormWriteServiceDeps;
  return { deps: value, calls };
}
const actor = { id: "editor-1" };
const base = { workspaceId: "ws-1", actor };
const HTML = '<input name="email" type="email" required>';
const existingHtml = { mode: "html", html: '<input name="old">' } as HtmlFormDefinitionRecord;
const fieldIds = (result: Awaited<ReturnType<typeof prepareFormAuthoring>>) => result?.fields?.map(field => field.id);

test("a write without mode/html re-derives fields only for an existing HTML form, without authorizing", async () => {
  const d = deps(false);
  const rederived = await prepareFormAuthoring({ deps: d.deps, input: base, existing: existingHtml });
  assert.equal(rederived?.mode, "html");
  assert.equal(rederived?.html, '<input name="old">');
  assert.deepEqual(fieldIds(rederived), ["old"]);
  const emptyHtml = await prepareFormAuthoring({ deps: d.deps, input: base, existing: { mode: "html" } as HtmlFormDefinitionRecord });
  assert.deepEqual([emptyHtml?.mode, emptyHtml?.html, emptyHtml?.fields], ["html", "", []]);
  assert.equal(await prepareFormAuthoring({ deps: d.deps, input: base, existing: { mode: "builder" } as HtmlFormDefinitionRecord }), undefined);
  assert.equal(await prepareFormAuthoring({ deps: d.deps, input: base }), undefined);
  assert.deepEqual(d.calls, []);
});

test("staying in builder mode needs no HTML authority", async () => {
  const d = deps(false);
  assert.deepEqual(await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "builder" } }), { mode: "builder", html: undefined });
  assert.deepEqual(await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "builder" }, existing: { mode: "builder" } as HtmlFormDefinitionRecord }), { mode: "builder", html: undefined });
  assert.deepEqual(d.calls, []);
});

test("switching an HTML form back to builder requires pages.edit_html and clears the markup", async () => {
  const d = deps();
  assert.deepEqual(await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "builder" }, existing: existingHtml }), { mode: "builder", html: undefined });
  assert.deepEqual(d.calls, [{ principalId: "editor-1", permission: "pages.edit_html", workspaceId: "ws-1" }]);
  // Sending html alongside builder mode also needs authority, and still stores no markup.
  assert.deepEqual(await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "builder", html: HTML } }), { mode: "builder", html: undefined });
  assert.equal(d.calls.length, 2);
});

test("denied principals are refused before the HTML is parsed", async () => {
  const d = deps(false);
  // Over the 200000 character parser limit: a parse would throw a validation error instead.
  const huge = "x".repeat(200_001);
  for (const input of [{ ...base, html: huge }, { ...base, mode: "html" as const }, { ...base, mode: "builder" as const, html: HTML }]) {
    await assert.rejects(prepareFormAuthoring({ deps: d.deps, input, existing: existingHtml }), (error: unknown) => {
      assert.ok(error instanceof ForbiddenError);
      assert.equal(error.message, "HTML form authoring is restricted to admins and owners");
      assert.deepEqual({ permission: (error as ForbiddenError & { permission: string }).permission, reason: (error as ForbiddenError & { reason: string }).reason }, { permission: "pages.edit_html", reason: "role_lacks_permission" });
      return true;
    });
  }
});

test("an unknown mode is a field validation error once authorized", async () => {
  await assert.rejects(prepareFormAuthoring({ deps: deps().deps, input: { ...base, mode: "markdown" as never } }), (error: unknown) => {
    assert.ok(error instanceof FormFieldValidationError);
    assert.equal(error.message, "Invalid form mode");
    assert.deepEqual(error.fieldErrors, [{ field: "mode", reason: "must be builder or html" }]);
    return true;
  });
});

test("authorized HTML writes derive fields from the new markup, else from the existing markup", async () => {
  const d = deps();
  const fresh = await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "html", html: HTML }, existing: existingHtml });
  assert.deepEqual([fresh?.mode, fresh?.html, fieldIds(fresh)], ["html", HTML, ["email"]]);
  const htmlOnly = await prepareFormAuthoring({ deps: d.deps, input: { ...base, html: HTML } });
  assert.deepEqual(fieldIds(htmlOnly), ["email"]);
  const kept = await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "html" }, existing: existingHtml });
  assert.deepEqual([kept?.html, fieldIds(kept)], ['<input name="old">', ["old"]]);
  const blank = await prepareFormAuthoring({ deps: d.deps, input: { ...base, mode: "html" } });
  assert.deepEqual([blank?.html, blank?.fields], ["", []]);
  await assert.rejects(prepareFormAuthoring({ deps: d.deps, input: { ...base, html: "<form></form><form></form>" } }), FormFieldValidationError);
});

function recordingRepo() {
  const calls: Array<[string, unknown]> = [];
  const record = { id: "f1", workspaceId: "ws-1", fields: [{ id: "x" }], name: "Form" } as unknown as FormDefinitionRecord;
  const repo: FormDefinitionRepoPort = {
    findById: async (target) => { calls.push(["findById", target]); return target.id === "f1" ? { ...record } : null; },
    findBySlug: async (target) => { calls.push(["findBySlug", target]); return record; },
    list: async (target) => { calls.push(["list", target]); return [record]; },
    isSlugTaken: async (target) => { calls.push(["isSlugTaken", target]); return true; },
    create: async (value) => { calls.push(["create", { ...value }]); },
    update: async (value) => { calls.push(["update", { ...value }]); },
  } as FormDefinitionRepoPort;
  return { repo, calls, record };
}

test("withFormAuthoring writes the authoring fields in the same create/update call", async () => {
  const { repo, calls } = recordingRepo();
  const authoring = { mode: "html" as const, html: HTML, fields: [] };
  const wrapped = withFormAuthoring({ repo, authoring });
  const created = { id: "f2", fields: [{ id: "a" }], name: "New" } as unknown as FormDefinitionRecord;
  await wrapped.create(created);
  await wrapped.update({ id: "f1", name: "Edited" } as unknown as FormDefinitionRecord);
  assert.deepEqual(calls, [
    ["create", { id: "f2", fields: [], name: "New", mode: "html", html: HTML }],
    ["update", { id: "f1", name: "Edited", mode: "html", html: HTML, fields: [] }],
  ]);
  // The caller's record object carries the authored state afterwards too.
  assert.equal((created as HtmlFormDefinitionRecord).html, HTML);
});

test("withFormAuthoring forwards reads unchanged, clearing fields on findById only when replacing", async () => {
  const { repo, calls, record } = recordingRepo();
  const plain = withFormAuthoring({ repo, authoring: { mode: "builder" } });
  assert.deepEqual(await plain.findById({ workspaceId: "ws-1", id: "f1" } as never), record);
  assert.equal(await plain.findBySlug({ workspaceId: "ws-1", slug: "s" } as never), record);
  assert.deepEqual(await plain.list({ workspaceId: "ws-1" } as never), [record]);
  assert.equal(await plain.isSlugTaken({ workspaceId: "ws-1", slug: "s" } as never), true);
  const replacing = withFormAuthoring({ repo, authoring: { mode: "html", html: HTML } }, { replaceFields: true });
  assert.deepEqual(await replacing.findById({ workspaceId: "ws-1", id: "f1" } as never), { ...record, fields: [] });
  assert.equal(await replacing.findById({ workspaceId: "ws-1", id: "missing" } as never), null);
  assert.deepEqual(calls.map(([name, target]) => [name, target]), [
    ["findById", { workspaceId: "ws-1", id: "f1" }], ["findBySlug", { workspaceId: "ws-1", slug: "s" }], ["list", { workspaceId: "ws-1" }],
    ["isSlugTaken", { workspaceId: "ws-1", slug: "s" }], ["findById", { workspaceId: "ws-1", id: "f1" }], ["findById", { workspaceId: "ws-1", id: "missing" }],
  ]);
});

test("htmlSubmissionDefinition presents authored checkbox strings as optional text, only for HTML forms", () => {
  const fields = [
    { id: "consent", type: "checkbox", required: true, checkboxValue: "yes" },
    { id: "news", type: "checkbox", required: true, checkboxValue: "" },
    { id: "bool", type: "checkbox", required: true, checkboxValue: "on" },
    { id: "plain", type: "checkbox", required: true },
    { id: "name", type: "text", required: true },
  ];
  const definition = { id: "f", mode: "html", fields } as unknown as FormDefinitionRecord;
  const body = { consent: "yes", news: "", bool: true, plain: "on", name: "Ada" };
  const result = htmlSubmissionDefinition({ definition, body });
  assert.deepEqual(result.fields, [
    { id: "consent", type: "text", required: false, checkboxValue: "yes" },
    { id: "news", type: "text", required: false, checkboxValue: "" },
    fields[2], fields[3], fields[4],
  ]);
  assert.equal((result as HtmlFormDefinitionRecord).mode, "html");
  // The stored definition is not mutated.
  assert.equal(fields[0]!.type, "checkbox");
  const builder = { id: "f", mode: "builder", fields } as unknown as FormDefinitionRecord;
  assert.equal(htmlSubmissionDefinition({ definition: builder, body }), builder);
});

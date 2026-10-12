import assert from "node:assert/strict";
import { test } from "vitest";
import { validateFieldDescriptors, validateSubmissionPayload } from "../forms.js";
import { renderHtmlForm } from "../html-render.js";
import { submitForm } from "../submit-service.js";
import type { FieldDescriptor, FormDefinitionRecord } from "../types.js";
import { toDefinitionRecord, toDefinitionRow, toSubmissionRecord, toSubmissionRow } from "../sql/repo.rows.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "../repo.memory.js";

const choices = [{ value: "sales", label: "Sales" }, { value: "help", label: "Help" }];
const cases: Array<{ type: FieldDescriptor["type"]; value: unknown; invalid: unknown; html: RegExp; extra?: Partial<FieldDescriptor> }> = [
  { type: "text", value: "Ada", invalid: 2, html: /type="text"/ },
  { type: "textarea", value: "Hello", invalid: true, html: /<textarea/ },
  { type: "email", value: "ada@example.com", invalid: "bad@", html: /type="email"/ },
  { type: "phone", value: "+1 (555) 123-4567", invalid: "call me", html: /type="tel"/ },
  { type: "url", value: "https:\/\/example.com", invalid: "javascript:alert(1)", html: /type="url"/ },
  { type: "number", value: "4", invalid: "Infinity", html: /type="number"/, extra: { min: 0, max: 10, step: 2 } },
  { type: "range", value: "4", invalid: "11", html: /type="range"/, extra: { min: 0, max: 10, step: 2 } },
  { type: "date", value: "2026-10-11", invalid: "2026-02-30", html: /type="date"/ },
  { type: "time", value: "12:30", invalid: "25:00", html: /type="time"/ },
  { type: "datetime", value: "2026-10-11T12:30", invalid: "2026-02-30T12:30", html: /type="datetime-local"/ },
  { type: "select", value: "sales", invalid: "other", html: /<select/, extra: { options: choices } },
  { type: "multi-select", value: ["sales", "help"], invalid: ["sales", "other"], html: /<select[^>]*multiple/, extra: { options: choices } },
  { type: "radio", value: "sales", invalid: ["sales"], html: /<fieldset[\s\S]*<legend[\s\S]*type="radio"/, extra: { options: choices } },
  { type: "checkbox", value: true, invalid: "false", html: /type="checkbox"/ },
  { type: "checkbox-group", value: ["help"], invalid: ["help", "help"], html: /<fieldset[\s\S]*<legend[\s\S]*type="checkbox"/, extra: { options: choices } },
  { type: "toggle", value: "on", invalid: 3, html: /role="switch"/ },
  { type: "hidden", value: "campaign", invalid: {}, html: /type="hidden"/ },
];
const field = (entry: typeof cases[number]): FieldDescriptor => ({ id: "answer", name: "answer", label: "Answer", type: entry.type, required: true, helpText: "Help <here>", ...entry.extra });
const definition = (fields: FieldDescriptor[]): FormDefinitionRecord => ({ id: "form", workspaceId: "ws", name: "Common", slug: "common", status: "active", fields, notify: { enabled: false, recipients: [] }, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", version: 1 });
const hooks = { field: "data-tovu-field", form: "data-tovu-form", success: "data-tovu-form-success", error: "data-tovu-form-error" };
for (const entry of cases) {
  test(`${entry.type}: semantic rendering, accept/reject and stored submission`, async () => {
    const f = field(entry); const d = definition([f]);
    assert.deepEqual(validateFieldDescriptors({ fields: [f] }), { valid: true });
    const html = renderHtmlForm({ slug: d.slug, action: "/forms/common/submit", fields: d.fields, hooks });
    assert.match(html, entry.html); if (entry.type !== "hidden") assert.match(html, /Help &lt;here&gt;/);
    assert.match(html, /aria-describedby="[^"]*answer-help/);
    assert.equal(validateSubmissionPayload({ definition: d, body: { answer: entry.invalid } }).valid, false);
    const valid = validateSubmissionPayload({ definition: d, body: { answer: entry.value } });
    assert.equal(valid.valid, true);
    const definitionRepo = new InMemoryFormDefinitionRepo(); const submissionRepo = new InMemoryFormSubmissionRepo();
    await definitionRepo.create(d); let id = 0;
    await submitForm({ deps: { definitionRepo, submissionRepo, clock: { nowMs: () => 0 }, idGen: { newId: () => `id-${++id}` }, rateLimiter: { check: async () => ({ allowed: true }) }, outbox: { enqueue: async () => {} }, dispatcher: { dispatch: async () => {} }, logger: { warn() {} } }, input: { workspaceId: "ws", slug: "common", sourceIp: "127.0.0.1", body: { answer: entry.value } } });
    const rows = await submissionRepo.listByDefinition({ workspaceId: "ws", formDefinitionId: "form", limit: 10 });
    assert.deepEqual(rows.items[0]?.data, valid.valid ? valid.data : {});
    assert.deepEqual(toSubmissionRecord(toSubmissionRow(rows.items[0]!) as Parameters<typeof toSubmissionRecord>[0]).data, rows.items[0]!.data);
    assert.deepEqual(toDefinitionRecord(toDefinitionRow(d) as Parameters<typeof toDefinitionRecord>[0]).fields, d.fields);
  });
}

test("server rejects unknown keys, scalar duplicates, invalid lengths/patterns, invalid defaults and option definitions", () => {
  const f = field(cases[0]!); const d = definition([f]);
  for (const body of [{ answer: "Ada", extra: "x" }, { answer: ["Ada", "Eve"] }]) assert.equal(validateSubmissionPayload({ definition: d, body }).valid, false);
  assert.equal(validateSubmissionPayload({ definition: definition([{ ...f, minLength: 3, maxLength: 4, pattern: "[A-Z]+" }]), body: { answer: "abc" } }).valid, false);
  for (const patch of [{ required: "true" }, { minLength: -1 }, { pattern: "(a+)+$" }, { default: 2 }, { options: choices }, { name: "different" }]) {
    assert.equal(validateFieldDescriptors({ fields: [{ ...f, ...patch } as FieldDescriptor] }).valid, false);
  }
  for (const options of [[], [{ value: "x", label: "X" }, { value: "x", label: "Duplicate" }]]) assert.equal(validateFieldDescriptors({ fields: [{ ...f, type: "select", options }] }).valid, false);
});

test("native required consent must be checked; browser numeric constraints and full-match patterns are rechecked", () => {
  assert.equal(validateSubmissionPayload({ definition: definition([{ ...field(cases[0]!), type: "checkbox" }]), body: { answer: false } }).valid, false);
  for (const answer of ["3", "-2", "12", "", "0x4", "4\n"]) assert.equal(validateSubmissionPayload({ definition: definition([field(cases[5]!)]), body: { answer } }).valid, false);
  assert.equal(validateSubmissionPayload({ definition: definition([{ ...field(cases[0]!), pattern: "[A-Z]+" }]), body: { answer: "ABC\n" } }).valid, false);
});

test("defaults/options/help/constraints render escaped and nested memory records cannot alias stored state", async () => {
  const f: FieldDescriptor = { id: "topic", label: "Topic <x>", type: "select", required: true, options: structuredClone(choices), default: "help", helpText: "Help", className: 'wide" onclick="alert(1)', attributes: { "data-hint": '<x>' } };
  const d = definition([f]); const repo = new InMemoryFormDefinitionRepo(); await repo.create(d);
  f.options![0]!.label = "changed";
  const read = (await repo.findById({ workspaceId: "ws", id: "form" }))!;
  assert.equal(read.fields[0]!.options![0]!.label, "Sales");
  const html = renderHtmlForm({ slug: "common", action: "/forms/common/submit", fields: read.fields, hooks });
  assert.match(html, /value="help" selected>Help/); assert.match(html, /Topic &lt;x&gt;/); assert.match(html, /wide&quot; onclick=&quot;alert\(1\)/); assert.match(html, /data-hint="&lt;x&gt;"/);
  read.fields[0]!.options![0]!.label = "edited";
  assert.equal((await repo.findById({ workspaceId: "ws", id: "form" }))!.fields[0]!.options![0]!.label, "Sales");
});

test("date/time bounds normalize equivalent native formats and reject values outside the range", () => {
  const timed: FieldDescriptor = { id: "answer", label: "Time", type: "time", required: true, min: "12:30:00.100", max: "12:30:00.100" };
  assert.deepEqual(validateFieldDescriptors({ fields: [{ ...timed, min: "12:30:00.1", max: "12:30:00.100" }] }), { valid: true });
  assert.equal(validateFieldDescriptors({ fields: [{ ...timed, min: "12:30:00.200", max: "12:30:00.1" }] }).valid, false);
  assert.equal(validateSubmissionPayload({ definition: definition([timed]), body: { answer: "12:30:00.1" } }).valid, true);
  assert.equal(validateSubmissionPayload({ definition: definition([timed]), body: { answer: "12:30" } }).valid, false);
  const datetime: FieldDescriptor = { ...timed, type: "datetime", min: "2026-10-11T12:30:00", max: "2026-10-11T12:30:00" };
  assert.equal(validateSubmissionPayload({ definition: definition([datetime]), body: { answer: "2026-10-11T12:30" } }).valid, true);
  assert.equal(validateSubmissionPayload({ definition: definition([datetime]), body: { answer: "2026-10-12T12:30" } }).valid, false);
});

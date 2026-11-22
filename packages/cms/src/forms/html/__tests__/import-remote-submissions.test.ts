import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { FormDefinitionRecord, FormSubmissionRecord } from "../../types.js";
import { importRemoteFormSubmissions, type ImportRemoteSubmissionsDeps, type RemoteSubmissionInput } from "../import-remote-submissions.js";

/** @file Unit tests for importing submissions a static host stored, with in-memory ports. */

const base = { workspaceId: "w", name: "Waitlist", notify: { enabled: true, recipients: [] }, createdAt: "t", updatedAt: "t", version: 1 };
const waitlist: FormDefinitionRecord = { ...base, id: "f1", slug: "waitlist", status: "active", fields: [
  { id: "email", label: "Email", type: "email", required: true, maxLength: 254 },
  { id: "note", label: "Note", type: "textarea", required: false, maxLength: 5 },
] };
const disabled: FormDefinitionRecord = { ...waitlist, id: "f2", slug: "old", status: "disabled" };

function setup({ failCreateOn, definitions = [waitlist, disabled] }: { failCreateOn?: string; definitions?: FormDefinitionRecord[] } = {}) {
  const rows: FormSubmissionRecord[] = [];
  const events: DomainEvent[] = [];
  const receipts = new Map<string, string>();
  const lookups: string[] = [];
  let ids = 0;
  const deps: ImportRemoteSubmissionsDeps = {
    definitionRepo: { findBySlug: async ({ slug }) => { lookups.push(slug); return definitions.find((d) => d.slug === slug) ?? null; } },
    submissionRepo: {
      create: async (record) => { if (record.data.email === failCreateOn) throw new Error("disk full"); rows.push(record); },
      // Rolls back every write made inside `work` when it throws, like the store's real transaction.
      transaction: async (work) => {
        const snapshot = { rows: rows.length, events: events.length, receipts: new Map(receipts) };
        try { return await work(); } catch (error) {
          rows.length = snapshot.rows; events.length = snapshot.events; receipts.clear();
          for (const [key, value] of snapshot.receipts) receipts.set(key, value);
          throw error;
        }
      },
    },
    receipts: { claim: async ({ workspaceId, destinationKey, remoteId, submissionId }) => {
      const key = `${workspaceId}|${destinationKey}|${remoteId}`;
      if (receipts.has(key)) return false;
      receipts.set(key, submissionId);
      return true;
    } },
    outbox: { enqueue: async (event) => { events.push(event); } },
    clock: { nowMs: () => Date.parse("2026-10-19T12:00:00.000Z") },
    idGen: { newId: () => `id-${++ids}` },
  };
  return { deps, rows, events, receipts, lookups };
}

const row = (id: string, answers: Record<string, unknown>, extra: Partial<RemoteSubmissionInput> = {}): RemoteSubmissionInput =>
  ({ id, formSlug: "waitlist", answers, submittedAt: "2026-10-19T10:00:00.000Z", ip: "203.0.113.9", ...extra });

test("valid rows become submissions with one received event each, keeping the host's time and IP", async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "host:https://a.example", items: [row("r1", { email: "a@b.co", note: "hi" })] });
  assert.deepEqual(result, { committedIds: ["r1"], imported: 1, duplicates: 0, invalid: [], skipped: [], forms: [{ formSlug: "waitlist", imported: 1, alreadyImported: 0, unmapped: 0 }] });
  assert.deepEqual(s.rows, [{ id: "id-1", workspaceId: "w", formDefinitionId: "f1", data: { email: "a@b.co", note: "hi" }, sourceIp: "203.0.113.9", submittedAt: "2026-10-19T10:00:00.000Z" }]);
  assert.deepEqual(s.events, [{ id: "id-2", name: "form.submission.received", occurredAt: "2026-10-19T12:00:00.000Z", workspaceId: "w", aggregateId: "id-1", payload: { workspaceId: "w", formDefinitionId: "f1", submissionId: "id-1", deliveryMode: "remote_import" } }]);
});

test("a row seen again (same destination and remote id) is acknowledged as a duplicate and writes nothing", async () => {
  const s = setup();
  const input = { deps: s.deps, workspaceId: "w", destinationKey: "host:https://a.example", items: [row("r1", { email: "a@b.co" })] };
  await importRemoteFormSubmissions(input);
  const again = await importRemoteFormSubmissions({ ...input, items: [row("r1", { email: "a@b.co" }), row("r1", { email: "a@b.co" })] });
  assert.deepEqual(again, { committedIds: ["r1", "r1"], imported: 0, duplicates: 2, invalid: [], skipped: [], forms: [{ formSlug: "waitlist", imported: 0, alreadyImported: 2, unmapped: 0 }] });
  assert.equal(s.rows.length, 1);
  assert.equal(s.events.length, 1, "notifications fire once");
  const other = await importRemoteFormSubmissions({ ...input, destinationKey: "host:https://b.example" });
  assert.equal(other.imported, 1, "another destination's remote id is a different row");
});

test("rows the live validator rejects are imported with declared text fields only and listed with their errors", async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("r1", { email: "", note: "too long", extra: "x" }, { submittedAt: "not a date", ip: null }),
    row("r2", { email: ["a", "b"], note: 7 }),
  ] });
  assert.equal(result.imported, 2);
  assert.deepEqual(result.invalid.map(({ remoteId, submissionId }) => [remoteId, submissionId]), [["r1", "id-1"], ["r2", "id-2"]], "an invalid row draws no event id");
  assert.ok(result.invalid[0]!.fieldErrors.some((error) => error.field === "extra"), "unknown keys are reported");
  assert.deepEqual(s.rows.map((stored) => stored.data), [{ email: "", note: "too l" }, { email: ["a", "b"] }], "values are cut to the field's cap (note: maxLength 5)");
  assert.equal(s.rows[0]!.submittedAt, "2026-10-19T12:00:00.000Z", "an unusable host time falls back to the import time");
  assert.equal(s.rows[0]!.sourceIp, null);
  assert.deepEqual(s.events, [], "invalid rows emit no received event");
});

test("T9: remote imports report the live submit path's default text-length violations", async () => {
  const s = setup({ definitions: [{ ...waitlist, fields: [
    waitlist.fields[0]!,
    { id: "name", label: "Name", type: "text", required: false },
    { id: "note", label: "Note", type: "textarea", required: false, maxLength: null },
  ] }] });
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("below", { email: "a@b.co", name: "a".repeat(99), note: "m".repeat(1999) }),
    row("at", { email: "a@b.co", name: "😀".repeat(100), note: "🎉".repeat(2000) }),
    row("over", { email: "a@b.co", name: "a".repeat(101), note: "m".repeat(2001) }),
  ] });

  assert.deepEqual(result.committedIds, ["below", "at", "over"], "invalid remote rows remain available for admin review");
  assert.deepEqual(result.invalid.map(({ remoteId, fieldErrors }) => ({ remoteId, fieldErrors })), [
    { remoteId: "over", fieldErrors: [{ field: "name", reason: "too_long" }, { field: "note", reason: "too_long" }] },
  ]);
});

test("T9: an invalid remote row is stored cut to the live text caps (100 one-line, 2000 long text) and nothing is lost", async () => {
  const s = setup({ definitions: [{ ...waitlist, fields: [
    waitlist.fields[0]!,
    { id: "name", label: "Name", type: "text", required: false },
    { id: "note", label: "Note", type: "textarea", required: false, maxLength: null },
    { id: "size", label: "Size", type: "select", required: false, options: [{ label: "Small", value: "s" }] },
  ] }] });
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("over", { email: "a@b.co", name: "😀".repeat(150), note: "m".repeat(5000), size: "x".repeat(3000) }),
  ] });
  assert.deepEqual(result.committedIds, ["over"], "the invalid row is still imported for review");
  assert.equal(result.invalid.length, 1);
  assert.deepEqual(s.rows.map((stored) => stored.data), [{ email: "a@b.co", name: "😀".repeat(100), note: "m".repeat(2000), size: "x".repeat(2000) }]);
});

test("T9: an invalid remote row emits no form.submission.received; a valid one beside it still does", async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("bad", { email: "" }), row("good", { email: "a@b.co" }),
  ] });
  assert.deepEqual(result.invalid.map(({ remoteId }) => remoteId), ["bad"]);
  assert.equal(s.rows.length, 2, "both rows are stored");
  const good = s.rows.find((stored) => stored.data.email === "a@b.co")!;
  assert.deepEqual(s.events.map(({ name, aggregateId }) => ({ name, aggregateId })), [{ name: "form.submission.received", aggregateId: good.id }]);
});

test("rows for a form that no longer exists are skipped and not acknowledged; a disabled form still imports", async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("r1", { email: "a@b.co" }, { formSlug: "gone" }), row("r2", { email: "a@b.co" }, { formSlug: "gone" }), row("r3", { email: "a@b.co" }, { formSlug: "old" }),
  ] });
  assert.deepEqual(result.skipped, [{ remoteId: "r1", formSlug: "gone", reason: "unknown_form" }, { remoteId: "r2", formSlug: "gone", reason: "unknown_form" }]);
  assert.deepEqual(result.committedIds, ["r3"]);
  assert.deepEqual(s.lookups, ["gone", "old"], "each slug is looked up once per page");
  assert.deepEqual(result.forms, [{ formSlug: "gone", imported: 0, alreadyImported: 0, unmapped: 2 }, { formSlug: "old", imported: 1, alreadyImported: 0, unmapped: 0 }]);
});

test("a failed write rolls back that row's receipt and event, stops the page and leaves earlier rows committed", async () => {
  const s = setup({ failCreateOn: "bad@b.co" });
  await assert.rejects(importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("r1", { email: "a@b.co" }), row("r2", { email: "bad@b.co" }), row("r3", { email: "c@b.co" }),
  ] }), /disk full/);
  assert.deepEqual(s.rows.map((stored) => stored.data.email), ["a@b.co"]);
  assert.equal(s.events.length, 1);
  assert.deepEqual([...s.receipts.keys()], ["w|d|r1"], "the failed row can be retried");
});

test("without a store transaction the writes still run in order", async () => {
  const s = setup();
  const { transaction: _omit, ...plain } = s.deps.submissionRepo;
  const result = await importRemoteFormSubmissions({ deps: { ...s.deps, submissionRepo: plain }, workspaceId: "w", destinationKey: "d", items: [row("r1", { email: "a@b.co" })] });
  assert.equal(result.imported, 1);
});

test("the store's transaction is called on the store itself, as the SQL adapter's `this.kernel` needs", async () => {
  // Regression (2026-10-19, live byho.io pull): the import called a detached `transaction`, so the
  // SQL store failed with "Cannot read properties of undefined (reading 'kernel')" on every row.
  const s = setup();
  const inner = s.deps.submissionRepo;
  class KernelBackedRepo {
    private readonly kernel = { transaction: <T>(work: () => Promise<T>) => inner.transaction!(work) };
    create = inner.create;
    transaction<T>(work: () => Promise<T>): Promise<T> { return this.kernel.transaction(work); }
  }
  const result = await importRemoteFormSubmissions({ deps: { ...s.deps, submissionRepo: new KernelBackedRepo() }, workspaceId: "w", destinationKey: "d", items: [row("r1", { email: "a@b.co" })] });
  assert.deepEqual(result, { committedIds: ["r1"], imported: 1, duplicates: 0, invalid: [], skipped: [], forms: [{ formSlug: "waitlist", imported: 1, alreadyImported: 0, unmapped: 0 }] });
  assert.equal(s.rows.length, 1);
});

test("per-form counts keep first-seen order across interleaved forms; an invalid row counts as imported, a repeat as already imported", async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("r1", { email: "a@b.co" }, { formSlug: "old" }),
    row("r2", { email: "a@b.co" }),
    row("r3", { email: "" }, { formSlug: "old" }),
    row("r4", { email: "a@b.co" }, { formSlug: "gone" }),
    row("r2", { email: "a@b.co" }),
    row("r5", { email: "a@b.co" }),
  ] });
  assert.deepEqual(result.forms, [
    { formSlug: "old", imported: 2, alreadyImported: 0, unmapped: 0 },
    { formSlug: "waitlist", imported: 2, alreadyImported: 1, unmapped: 0 },
    { formSlug: "gone", imported: 0, alreadyImported: 0, unmapped: 1 },
  ]);
  assert.deepEqual([result.imported, result.duplicates, result.skipped.length, result.invalid.length], [4, 1, 1, 1], "the per-form counts add up to the totals");
});

test("a form slug shaped like an object key is counted as its own form", async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: "w", destinationKey: "d", items: [
    row("r1", { email: "a@b.co" }, { formSlug: "__proto__" }), row("r2", { email: "a@b.co" }, { formSlug: "constructor" }),
  ] });
  assert.deepEqual(result.forms, [{ formSlug: "__proto__", imported: 0, alreadyImported: 0, unmapped: 1 }, { formSlug: "constructor", imported: 0, alreadyImported: 0, unmapped: 1 }]);
});

test("an empty page reports no forms", async () => {
  assert.deepEqual((await importRemoteFormSubmissions({ deps: setup().deps, workspaceId: "w", destinationKey: "d", items: [] })).forms, []);
});

test('invalid imports durably retain classification and original validation errors beside accepted rows', async () => {
  const s = setup();
  const result = await importRemoteFormSubmissions({ deps: s.deps, workspaceId: 'w', destinationKey: 'd', items: [row('bad', { email: '', note: 'too long' }), row('good', { email: 'a@b.co' })] });
  assert.deepEqual(s.rows[0]!.validation, { status: 'invalid', fieldErrors: result.invalid[0]!.fieldErrors });
  assert.equal(s.rows[1]!.validation, undefined);
  assert.equal(s.events.length, 1);
  await importRemoteFormSubmissions({ deps: s.deps, workspaceId: 'w', destinationKey: 'd', items: [row('bad', { email: 'changed@x.co' })] });
  assert.deepEqual(s.rows[0]!.validation, { status: 'invalid', fieldErrors: result.invalid[0]!.fieldErrors });
});

test('late imports never revive an IP whose original submission is already 90 days old', async () => {
  const s = setup();
  await importRemoteFormSubmissions({ deps: s.deps, workspaceId: 'w', destinationKey: 'd', items: [row('old', { email: 'a@b.co' }, { submittedAt: '2026-01-01T00:00:00.000Z' })] });
  assert.equal(s.rows[0]!.sourceIp, null);
});

test('delayed imports retain published labels and consent rather than relabel against the current form', async () => {
  const s=setup({definitions:[{...waitlist,fields:[{id:'email',label:'Renamed email',type:'email',required:true}]}]});
  const evidence={version:1 as const,fields:[{id:'email',label:'Original email',type:'email' as const,required:true},{id:'accept',label:'Original consent wording',type:'checkbox' as const,required:true}],consent:[{fieldId:'accept',wording:'Original consent wording'}],schemaHash:'a'.repeat(64),capturedAt:'2026-10-19T10:00:00.000Z',source:'cloudflare' as const};
  const result=await importRemoteFormSubmissions({deps:s.deps,workspaceId:'w',destinationKey:'d',items:[row('historical',{email:'a@b.co',accept:true},{evidence})]});
  assert.equal(result.invalid.length,0);
  assert.deepEqual(s.rows[0]!.evidence,evidence);
  assert.equal(s.rows[0]!.data.accept,true);
});

test('malformed remote evidence is not acknowledged and leaves no receipt or submission', async () => {
  const s=setup();
  await assert.rejects(importRemoteFormSubmissions({deps:s.deps,workspaceId:'w',destinationKey:'d',items:[row('bad-evidence',{email:'a@b.co'},{evidence:{version:1}})]}),/evidence/i);
  assert.equal(s.rows.length,0); assert.equal(s.receipts.size,0);
});

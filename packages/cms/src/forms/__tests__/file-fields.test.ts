import assert from "node:assert/strict";
import { test } from "vitest";
import { validateFieldDescriptors, validateSubmissionPayload } from "../forms.js";
import { renderHtmlForm } from "../html-render.js";
import { submitForm, type SubmitFormDeps } from "../submit-service.js";
import { createSubmissionAttempts, submissionAttemptKey } from "../submission-attempts.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "../repo.memory.js";
import { toSubmissionRecord, toSubmissionRow, toDefinitionRecord, toDefinitionRow } from "../sql/repo.rows.js";
import type { FieldDescriptor, FormDefinitionRecord, FormFileInput, FormFileReference } from "../types.js";
import { FormSubmissionValidationError } from "../errors.js";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const file: FormFileInput = { filename: "photo.png", contentType: "image/png", bytes: png };
const field: FieldDescriptor = { id: "attachment", label: "Attachment", type: "file", required: true, accept: ["image/*"], maxFileSize: 20 };
const definition = (fields = [field]): FormDefinitionRecord => ({ id: "form", workspaceId: "ws", name: "Upload", slug: "upload", fields, notify: { enabled: false, recipients: [] }, status: "active", version: 1, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" });
const detectContentType = ({ bytes }: { bytes: Uint8Array }) => bytes[0] === 137 && bytes[1] === 80 ? "image/png" : "application/octet-stream";
function fixture() {
  const definitionRepo = new InMemoryFormDefinitionRepo(); const submissionRepo = new InMemoryFormSubmissionRepo();
  const stored: FormFileInput[] = []; const discarded: FormFileReference[] = []; let id = 0; let events = 0;
  const deps: SubmitFormDeps = { definitionRepo, submissionRepo, clock: { nowMs: () => 0 }, idGen: { newId: () => `id-${++id}` }, rateLimiter: { check: async () => ({ allowed: true }) }, outbox: { enqueue: async () => { events++; } }, dispatcher: { dispatch: async () => {} }, logger: { warn() {} },
    files: { detectContentType, store: async ({ file }) => { stored.push(file); return { mediaId: "asset", filename: file.filename, contentType: file.contentType, byteSize: file.bytes.byteLength }; }, discard: async ({ reference }) => { discarded.push(reference); } }, transaction: (work) => submissionRepo.transaction(work),
  };
  return { deps, stored, discarded, events: () => events, input: { workspaceId: "ws", slug: "upload", sourceIp: "127.0.0.1", body: { attachment: file } } };
}
test("file: renderer, allowlisted MIME/extension/magic/size validation and media-reference submission storage", async () => {
  const f = fixture(); const d = definition(); await f.deps.definitionRepo.create(d);
  assert.deepEqual(validateFieldDescriptors({ fields: d.fields }), { valid: true });
  assert.match(renderHtmlForm({ slug: "upload", fields: d.fields, action: "/forms/upload/submit", hooks: { field: "data-field", form: "data-form", success: "data-success", error: "data-error" } }), /enctype="multipart\/form-data"[\s\S]*type="file"[\s\S]*required[\s\S]*accept="image\/\*"/);
  assert.equal(validateSubmissionPayload({ definition: d, body: f.input.body }, { files: { detectContentType } }).valid, true);
  assert.equal(validateSubmissionPayload({ definition: d, body: { attachment: { ...file, contentType: "" } } }, { files: { detectContentType } }).valid, true);
  await submitForm({ deps: f.deps, input: f.input });
  const rows = await f.deps.submissionRepo.listByDefinition({ workspaceId: "ws", formDefinitionId: "form", limit: 10 });
  const row = rows.items[0]!;
  assert.deepEqual(row.data, { attachment: { mediaId: "asset", filename: "photo.png", contentType: "image/png", byteSize: 9 } });
  assert.equal(JSON.stringify(row).includes('"bytes"'), false); assert.equal(f.stored.length, 1); assert.equal(f.events(), 1);
  assert.deepEqual(toSubmissionRecord(toSubmissionRow(row) as Parameters<typeof toSubmissionRecord>[0]).data, row.data);
  assert.deepEqual(toDefinitionRecord(toDefinitionRow(d) as Parameters<typeof toDefinitionRecord>[0]).fields, d.fields);
});
test("file: executable extensions, spoofed MIME, magic mismatch, unrecognized, oversized and duplicate controls reject before storage", async () => {
  const f = fixture(); await f.deps.definitionRepo.create(definition());
  for (const attachment of [{ ...file, filename: "bad.exe.png" }, { ...file, filename: "bad.php" }, { ...file, filename: "../photo.png" }, { ...file, contentType: "text/html" }, { ...file, contentType: "__proto__" }, { ...file, bytes: new Uint8Array([77, 90]) }, { ...file, bytes: new Uint8Array(21) }, { ...file, bytes: new Uint8Array() }, [file, file], "asset-id", null]) {
    await assert.rejects(submitForm({ deps: f.deps, input: { ...f.input, body: { attachment } } }), FormSubmissionValidationError);
  }
  assert.equal(f.stored.length, 0); assert.equal(f.events(), 0);
  assert.equal((await f.deps.submissionRepo.listByDefinition({ workspaceId: "ws", formDefinitionId: "form", limit: 10 })).items.length, 0);
});
test("file: invalid sibling, honeypot, unknown key and rate refusal create no media", async () => {
  const f = fixture(); await f.deps.definitionRepo.create(definition([field, { id: "email", label: "Email", type: "email", required: true }]));
  await assert.rejects(submitForm({ deps: f.deps, input: { ...f.input, body: { attachment: file, email: "bad" } } }), FormSubmissionValidationError);
  await assert.rejects(submitForm({ deps: f.deps, input: { ...f.input, body: { attachment: file, email: "a@b.com", extra: "x" } } }), FormSubmissionValidationError);
  assert.deepEqual(await submitForm({ deps: f.deps, input: { ...f.input, body: { attachment: file, _hp: "bot" } } }), { status: "accepted" });
  await assert.rejects(submitForm({ deps: { ...f.deps, rateLimiter: { check: async () => ({ allowed: false, retryAfterSeconds: 1 }) } }, input: { ...f.input, body: { attachment: file, email: "a@b.com" } } }));
  assert.equal(f.stored.length, 0);
});
test("file: duplicate attempts upload once; a failed submission transaction compensates that attempt's media", async () => {
  const f = fixture(); await f.deps.definitionRepo.create(definition());
  const attempts = createSubmissionAttempts({ hash: (value) => value });
  await Promise.all([submitForm({ deps: f.deps, input: f.input }, { attempts }), submitForm({ deps: f.deps, input: f.input }, { attempts })]);
  assert.equal(f.stored.length, 1); assert.equal(f.events(), 1);
  const g = fixture(); await g.deps.definitionRepo.create(definition());
  await assert.rejects(submitForm({ deps: { ...g.deps, outbox: { enqueue: async () => { throw new Error("outbox failed"); } } }, input: g.input }), /outbox failed/);
  assert.equal(g.discarded.length, 1);
  assert.equal((await g.deps.submissionRepo.listByDefinition({ workspaceId: "ws", formDefinitionId: "form", limit: 10 })).items.length, 0);
});
test("file attempt hashing binds bytes and metadata without serializing byte index properties", () => {
  const f = fixture(); const seen: string[] = [];
  const hash = (value: string) => { seen.push(value); return value; };
  const first = submissionAttemptKey({ input: f.input, attemptToken: "one", hash });
  const same = submissionAttemptKey({ input: { ...f.input, body: { attachment: { ...file, bytes: new Uint8Array(png) } } }, attemptToken: "one", hash });
  const changed = submissionAttemptKey({ input: { ...f.input, body: { attachment: { ...file, bytes: new Uint8Array([...png, 2]) } } }, attemptToken: "one", hash });
  assert.equal(first, same); assert.notEqual(first, changed); assert.equal(seen.some((value) => value.includes('"bytes":{"0"')), false);
});

test("file: any safe type supports PDF while image-only fields refuse it; missing ports and invalid limits reject", () => {
  const pdf = { filename: "document.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7") };
  const files = { detectContentType: () => "application/pdf" };
  assert.equal(validateSubmissionPayload({ definition: definition([{ ...field, accept: ["*/*"] }]), body: { attachment: pdf } }, { files }).valid, true);
  assert.equal(validateSubmissionPayload({ definition: definition(), body: { attachment: pdf } }, { files }).valid, false);
  assert.equal(validateSubmissionPayload({ definition: definition(), body: { attachment: file } }).valid, false);
  for (const patch of [{ maxFileSize: 0 }, { maxFileSize: 10485761 }, { accept: ["application/x-msdownload"] }, { default: "asset" }]) assert.equal(validateFieldDescriptors({ fields: [{ ...field, ...patch }] }).valid, false);
});

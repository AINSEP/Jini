/** Boundary behaviour of `submitForm` pinned around its persistence, upload-compensation and attempt paths. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { FormDefinitionNotFoundError, FormRateLimitExceededError, FormSubmissionValidationError } from "../errors.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "../repo.memory.js";
import { createSubmissionAttempts } from "../submission-attempts.js";
import { submitForm, type SubmitFormDeps, type SubmitFormInput } from "../submit-service.js";
import type { FieldDescriptor, FormDefinitionRecord, FormFileInput, FormFileReference, FormFileStoragePort } from "../types.js";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const photo: FormFileInput = { filename: "photo.png", contentType: "image/png", bytes: png };
const fileField = (id: string): FieldDescriptor => ({ id, label: id, type: "file", required: true, accept: ["image/*"], maxFileSize: 20 });
const textField: FieldDescriptor = { id: "name", label: "Name", type: "text", required: true };

function definition(fields: FieldDescriptor[], status: FormDefinitionRecord["status"] = "active"): FormDefinitionRecord {
  return { id: "form", workspaceId: "ws", name: "Form", slug: "form", fields, notify: { enabled: false, recipients: [] }, status, version: 1, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" };
}

function fixture(fields: FieldDescriptor[], status: FormDefinitionRecord["status"] = "active") {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const warnings: Array<{ message: string; error: unknown }> = [];
  const discarded: FormFileReference[] = [];
  const stored: string[] = [];
  let events = 0;
  let dispatches = 0;
  let id = 0;
  const files: FormFileStoragePort = {
    detectContentType: ({ bytes }) => (bytes[0] === 137 ? "image/png" : "application/octet-stream"),
    store: async ({ fieldId, file }) => { stored.push(fieldId); return { mediaId: `media-${fieldId}`, filename: file.filename, contentType: file.contentType, byteSize: file.bytes.byteLength }; },
    discard: async ({ reference }) => { discarded.push(reference); },
  };
  const deps: SubmitFormDeps = {
    definitionRepo,
    submissionRepo,
    clock: { nowMs: () => 0 },
    idGen: { newId: () => `id-${++id}` },
    rateLimiter: { check: async () => ({ allowed: true }) },
    outbox: { enqueue: async () => { events += 1; } },
    dispatcher: { dispatch: async () => { dispatches += 1; } },
    logger: { warn: ({ message }, optional) => { warnings.push({ message, error: optional?.error }); } },
    files,
    transaction: (work) => submissionRepo.transaction(work),
  };
  const ready = definitionRepo.create(definition(fields, status));
  const rows = async () => (await submissionRepo.listByDefinition({ workspaceId: "ws", formDefinitionId: "form", limit: 10 })).items;
  const input = (body: Record<string, unknown>): SubmitFormInput => ({ workspaceId: "ws", slug: "form", sourceIp: "10.0.0.1", body });
  return { deps, files, ready, rows, input, warnings, discarded, stored, events: () => events, dispatches: () => dispatches };
}

const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

test("submitForm: a file submission without a transaction port is refused per file field before any upload", async () => {
  const f = fixture([fileField("front"), fileField("back")]);
  await f.ready;
  const { transaction: _omitted, ...deps } = f.deps;
  await assert.rejects(submitForm({ deps, input: f.input({ front: photo, back: photo }) }), (error: unknown) => {
    assert.ok(error instanceof FormSubmissionValidationError);
    assert.equal(error.message, "file submissions require transactional storage");
    assert.deepEqual(error.fieldErrors, [{ field: "front", reason: "file_storage_unavailable" }, { field: "back", reason: "file_storage_unavailable" }]);
    return true;
  });
  assert.deepEqual(f.stored, []);
});

test("submitForm: a scalar submission without a transaction port still writes the row and event", async () => {
  const f = fixture([textField]);
  await f.ready;
  const { transaction: _omitted, ...deps } = f.deps;
  assert.deepEqual(await submitForm({ deps, input: f.input({ name: "Ada" }) }), { status: "accepted" });
  assert.deepEqual([(await f.rows()).length, f.events()], [1, 1]);
});

test("submitForm: a failed second upload discards only the uploads already stored and rethrows the upload error", async () => {
  const f = fixture([fileField("front"), fileField("back")]);
  await f.ready;
  const store: FormFileStoragePort["store"] = async (args) => {
    if (args.fieldId === "back") throw new Error("media backend offline");
    return f.files.store(args);
  };
  await assert.rejects(submitForm({ deps: { ...f.deps, files: { ...f.files, store } }, input: f.input({ front: photo, back: photo }) }), { message: "media backend offline" });
  assert.deepEqual(f.discarded.map((reference) => reference.mediaId), ["media-front"]);
  assert.deepEqual([(await f.rows()).length, f.events()], [0, 0]);
});

test("submitForm: a failed upload cleanup is logged and the original submission error still propagates", async () => {
  const f = fixture([fileField("front")]);
  await f.ready;
  const cleanupError = new Error("discard refused");
  const discard: FormFileStoragePort["discard"] = async () => { throw cleanupError; };
  const outbox: SubmitFormDeps["outbox"] = { enqueue: async () => { throw new Error("outbox failed"); } };
  await assert.rejects(submitForm({ deps: { ...f.deps, outbox, files: { ...f.files, discard } }, input: f.input({ front: photo }) }), { message: "outbox failed" });
  assert.deepEqual(f.warnings, [{ message: "form upload cleanup failed", error: cleanupError }]);
});

test("submitForm: a throwing logger during upload cleanup cannot replace the original submission error", async () => {
  const f = fixture([fileField("front")]);
  await f.ready;
  const discard: FormFileStoragePort["discard"] = async () => { throw new Error("discard refused"); };
  const outbox: SubmitFormDeps["outbox"] = { enqueue: async () => { throw new Error("outbox failed"); } };
  const logger: SubmitFormDeps["logger"] = { warn: () => { throw new Error("logger down"); } };
  await assert.rejects(submitForm({ deps: { ...f.deps, outbox, logger, files: { ...f.files, discard } }, input: f.input({ front: photo }) }), { message: "outbox failed" });
});

test("submitForm: with attempts, the _attempt token is stripped before validation and never stored", async () => {
  const f = fixture([textField]);
  await f.ready;
  const attempts = createSubmissionAttempts({ hash: (value) => value });
  await submitForm({ deps: f.deps, input: f.input({ name: "Ada", _attempt: "tok" }) }, { attempts });
  assert.deepEqual((await f.rows()).map((row) => row.data), [{ name: "Ada" }]);
});

test("submitForm: without attempts, an _attempt key is an unregistered field", async () => {
  const f = fixture([textField]);
  await f.ready;
  await assert.rejects(submitForm({ deps: f.deps, input: f.input({ name: "Ada", _attempt: "tok" }) }), (error: unknown) => {
    assert.ok(error instanceof FormSubmissionValidationError);
    assert.deepEqual(error.fieldErrors, [{ field: "_attempt", reason: "unregistered_key" }]);
    return true;
  });
});

test("submitForm: a duplicate attempt is accepted without a second row, event or dispatch", async () => {
  const f = fixture([textField]);
  await f.ready;
  const attempts = createSubmissionAttempts({ hash: (value) => value });
  await submitForm({ deps: f.deps, input: f.input({ name: "Ada", _attempt: "tok" }) }, { attempts });
  assert.deepEqual(await submitForm({ deps: f.deps, input: f.input({ name: "Ada", _attempt: "tok" }) }, { attempts }), { status: "accepted" });
  await settle();
  assert.deepEqual([(await f.rows()).length, f.events(), f.dispatches()], [1, 1, 1]);
});

test("submitForm: different attempt tokens for the same body each store a row", async () => {
  const f = fixture([textField]);
  await f.ready;
  const attempts = createSubmissionAttempts({ hash: (value) => value });
  await submitForm({ deps: f.deps, input: f.input({ name: "Ada", _attempt: "one" }) }, { attempts });
  await submitForm({ deps: f.deps, input: f.input({ name: "Ada", _attempt: "two" }) }, { attempts });
  assert.equal((await f.rows()).length, 2);
});

test("submitForm: the definition view replaces the stored definition for validation", async () => {
  const f = fixture([textField]);
  await f.ready;
  const definitionView = () => definition([{ ...textField, id: "nickname" }]);
  await submitForm({ deps: f.deps, input: f.input({ nickname: "Ada" }) }, { definitionView });
  assert.deepEqual((await f.rows()).map((row) => row.data), [{ nickname: "Ada" }]);
});

test("submitForm: a definition view that disables the form answers not found", async () => {
  const f = fixture([textField]);
  await f.ready;
  const definitionView = () => definition([textField], "disabled");
  await assert.rejects(submitForm({ deps: f.deps, input: f.input({ name: "Ada" }) }, { definitionView }), (error: unknown) => {
    assert.ok(error instanceof FormDefinitionNotFoundError);
    assert.equal(error.message, "form 'form' was not found");
    return true;
  });
});

test("submitForm: a missing slug answers not found even with the definition view and email checks enabled", async () => {
  const f = fixture([textField]);
  await f.ready;
  let viewed = 0;
  const definitionView = ({ definition: stored }: { definition: FormDefinitionRecord }) => { viewed += 1; return stored; };
  await assert.rejects(submitForm({ deps: f.deps, input: { ...f.input({ name: "Ada" }), slug: "nope" } }, { definitionView, validateEmails: true }), { message: "form 'nope' was not found" });
  assert.equal(viewed, 0);
});

test("submitForm: validateEmails refuses an invalid email on an active form", async () => {
  const f = fixture([{ id: "email", label: "Email", type: "email", required: true }]);
  await f.ready;
  await assert.rejects(submitForm({ deps: f.deps, input: f.input({ email: "bad" }) }, { validateEmails: true }), (error: unknown) => {
    assert.ok(error instanceof FormSubmissionValidationError);
    assert.deepEqual(error.fieldErrors, [{ field: "email", reason: "invalid_email" }]);
    return true;
  });
});

test("submitForm: a rate-limit refusal names the form and carries retryAfterSeconds", async () => {
  const f = fixture([textField]);
  await f.ready;
  const rateLimiter: SubmitFormDeps["rateLimiter"] = { check: async () => ({ allowed: false, retryAfterSeconds: 7 }) };
  await assert.rejects(submitForm({ deps: { ...f.deps, rateLimiter }, input: f.input({ name: "Ada" }) }), (error: unknown) => {
    assert.ok(error instanceof FormRateLimitExceededError);
    assert.equal(error.message, "rate limit exceeded for form 'form'");
    assert.equal(error.retryAfterSeconds, 7);
    return true;
  });
});

test("submitForm: the dispatch option replaces the bound dispatcher", async () => {
  const f = fixture([textField]);
  await f.ready;
  let custom = 0;
  await submitForm({ deps: f.deps, input: f.input({ name: "Ada" }) }, { dispatch: async () => { custom += 1; } });
  await settle();
  assert.deepEqual([custom, f.dispatches()], [1, 0]);
});

test("submitForm: a failing dispatch is logged and never rejects the accepted submission", async () => {
  const f = fixture([textField]);
  await f.ready;
  const dispatchError = new Error("smtp down");
  assert.deepEqual(await submitForm({ deps: f.deps, input: f.input({ name: "Ada" }) }, { dispatch: async () => { throw dispatchError; } }), { status: "accepted" });
  await settle();
  assert.deepEqual(f.warnings, [{ message: "form outbox dispatch failed", error: dispatchError }]);
});

test("submitForm: a throwing logger on dispatch failure is swallowed", async () => {
  const f = fixture([textField]);
  await f.ready;
  const logger: SubmitFormDeps["logger"] = { warn: () => { throw new Error("logger down"); } };
  const result = await submitForm({ deps: { ...f.deps, logger }, input: f.input({ name: "Ada" }) }, { dispatch: async () => { throw new Error("smtp down"); } });
  await settle();
  assert.deepEqual(result, { status: "accepted" });
});

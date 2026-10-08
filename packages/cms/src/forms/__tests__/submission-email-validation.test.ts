/** Todo 15b: the public submission boundary must enforce native email syntax before writes. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryEventBus, InMemoryOutbox } from "./eventing.fixture.js";
import { FormDefinitionNotFoundError, FormSubmissionValidationError, type FormDefinitionRecord } from "../index.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./support/repo-ports.fixture.js";
import { submitForm } from "./support/host-ports.fixture.js";

async function fixture(overrides: Partial<FormDefinitionRecord> = {}) {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const outbox = new InMemoryOutbox();
  const definition: FormDefinitionRecord = {
    id: "f1", workspaceId: "w1", name: "Contact", slug: "contact", version: 1, status: "active",
    fields: [{ id: "email", label: "Email", type: "email", required: true }],
    notify: { enabled: false, recipients: [] }, createdAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z", ...overrides,
  };
  await definitionRepo.create(definition);
  let rateChecks = 0;
  let ids = 0;
  const deps = { definitionRepo, submissionRepo, outbox, bus: new InMemoryEventBus(), clock: { nowMs: () => 1 }, idGen: { newId: () => `id-${++ids}` }, rateLimiter: { check: async () => { rateChecks++; return { allowed: true as const }; } } };
  return {
    submit: (body: Record<string, unknown>) => submitForm({ deps, input: { workspaceId: "w1", slug: "contact", sourceIp: "127.0.0.1", body } }),
    rows: () => submissionRepo.listByDefinition({ workspaceId: "w1", formDefinitionId: "f1", limit: 10 }),
    checks: () => rateChecks,
  };
}

test("15b rejects malformed email with exact safe errors and no writes or rate check", async () => {
  for (const email of ["not-an-email", "a@@b.com", "a b@example.com", "a@-example.com", "a@example..com", "a@example.com\n", "a@example.com,b@example.com"]) {
    const f = await fixture();
    await assert.rejects(() => f.submit({ email }), (error: unknown) => {
      assert.ok(error instanceof FormSubmissionValidationError);
      assert.equal(error.message, "submission failed field validation");
      assert.deepEqual(error.fieldErrors, [{ field: "email", reason: "invalid_email" }]);
      return true;
    });
    assert.equal((await f.rows()).items.length, 0);
    assert.equal(f.checks(), 0);
  }
});

test("15b accepts browser-valid email including plus addressing and single-label domains", async () => {
  for (const email of ["ada@example.com", "ada+news@sub.example.com", "ada@localhost", "x'y@example.com"]) {
    const f = await fixture();
    assert.deepEqual(await f.submit({ email }), { status: "accepted" });
    const page = await f.rows();
    assert.ok(page.items[0]);
    assert.equal(page.items[0].data.email, email);
  }
});

test("15b optional empty/missing email remains allowed; other field types stay unchanged", async () => {
  for (const body of [{}, { email: "" }]) {
    const f = await fixture({ fields: [{ id: "email", label: "Email", type: "email", required: false }] });
    assert.deepEqual(await f.submit(body), { status: "accepted" });
  }
  const f = await fixture({ fields: [{ id: "email", label: "Text", type: "text", required: true }] });
  assert.deepEqual(await f.submit({ email: "not-an-email" }), { status: "accepted" });
});

test("15b retains required/type/length errors and accumulates multiple email errors", async () => {
  const f = await fixture({ fields: [
    { id: "email", label: "Email", type: "email", required: true },
    { id: "backup", label: "Backup", type: "email", required: false },
    { id: "name", label: "Name", type: "text", required: true },
  ] });
  await assert.rejects(() => f.submit({ email: "bad", backup: "also-bad" }), (error: unknown) => {
    assert.ok(error instanceof FormSubmissionValidationError);
    assert.deepEqual(error.fieldErrors, [{ field: "email", reason: "invalid_email" }, { field: "backup", reason: "invalid_email" }, { field: "name", reason: "required" }]);
    return true;
  });
  for (const [body, reason] of [[{}, "required"], [{ email: 3 }, "must be a string"], [{ email: " " }, "required"], [{ email: "badbad" }, "too_long"]] as const) {
    const g = await fixture({ fields: [{ id: "email", label: "Email", type: "email", required: true, maxLength: 5 }] });
    await assert.rejects(() => g.submit(body), (error: unknown) => {
      assert.ok(error instanceof FormSubmissionValidationError);
      assert.deepEqual(error.fieldErrors, [{ field: "email", reason }]);
      return true;
    });
  }
});

test("15b preserves honeypot silent acceptance and disabled-as-not-found", async () => {
  const f = await fixture();
  assert.deepEqual(await f.submit({ email: "not-an-email", _hp: "bot" }), { status: "accepted" });
  assert.equal((await f.rows()).items.length, 0);
  const disabled = await fixture({ status: "disabled" });
  await assert.rejects(() => disabled.submit({ email: "not-an-email" }), FormDefinitionNotFoundError);
});


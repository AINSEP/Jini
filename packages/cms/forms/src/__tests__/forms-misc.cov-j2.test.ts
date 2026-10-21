import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryOutbox, createRateLimiter } from "./eventing.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "./repo.fixture.js";
import {
  FormDefinitionNotFoundError,
  FormRateLimitExceededError,
  FormSlugConflictError,
  FormSubmissionNotFoundError,
} from "../errors.js";
import { validateFieldDescriptors } from "../forms.js";
import { submitForm } from "../submit-service.js";
import type { FormDefinitionRecord } from "../types.js";

const NOW = "2026-07-13T00:00:00.000Z";

test("error types: each carries its message plus its own typed detail and stays an Error", () => {
  const conflict = new FormSlugConflictError({ message: "slug taken", slug: "contact" });
  const missingSubmission = new FormSubmissionNotFoundError({ message: "submission 's-1' was not found" });
  const missingDefinition = new FormDefinitionNotFoundError({ message: "form 'x' was not found" });
  const limited = new FormRateLimitExceededError({ message: "slow down", retryAfterSeconds: 42 });

  assert.ok(conflict instanceof Error);
  assert.equal(conflict.message, "slug taken");
  assert.equal(conflict.slug, "contact");
  assert.ok(missingSubmission instanceof Error);
  assert.equal(missingSubmission.message, "submission 's-1' was not found");
  assert.ok(!(missingSubmission instanceof FormDefinitionNotFoundError), "the two not-found types must stay distinguishable");
  assert.equal(missingDefinition.message, "form 'x' was not found");
  assert.equal(limited.retryAfterSeconds, 42);
});

test("validateFieldDescriptors: a checkbox with a string checkboxValue is valid authoring metadata", () => {
  assert.deepEqual(
    validateFieldDescriptors({ fields: [{ id: "consent", label: "Consent", type: "checkbox", required: true, checkboxValue: "yes" }] }),
    { valid: true },
  );
});

test("submitForm: a dispatch failure whose warning logger also throws never rejects or leaks", async () => {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const definition: FormDefinitionRecord = {
    id: "def-1", workspaceId: "ws-1", name: "Contact", slug: "contact",
    fields: [{ id: "name", label: "Name", type: "text", required: true }],
    notify: { enabled: false, recipients: [] }, status: "active", version: 1, createdAt: NOW, updatedAt: NOW,
  };
  await definitionRepo.create(definition);
  const warnAttempts: unknown[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    let counter = 0;
    const result = await submitForm({
      deps: {
        definitionRepo, submissionRepo, outbox: new InMemoryOutbox(),
        clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => `id-${++counter}` },
        rateLimiter: createRateLimiter(),
        dispatcher: { dispatch: async () => { throw new Error("broker down"); } },
        logger: { warn: (args: unknown) => { warnAttempts.push(args); throw new Error("logger down"); } },
      },
      input: { workspaceId: "ws-1", slug: "contact", body: { name: "Ada" }, sourceIp: "1.1.1.1" },
    });
    assert.deepEqual(result, { status: "accepted" });
    // Let the detached dispatch chain settle (rejection -> catch -> throwing logger).
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(warnAttempts, [{ message: "form outbox dispatch failed" }]);
    assert.deepEqual(unhandled, []);
    assert.equal((await submissionRepo.listByDefinition({ workspaceId: "ws-1", formDefinitionId: "def-1", limit: 10 })).items.length, 1);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

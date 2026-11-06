/**
 * @file Unit tests for one delivery attempt: which adapter results count as success, and how every
 * failure shape (result object, malformed result, throw) becomes a ledger-safe FormDeliveryError.
 */
import { describe, expect, test } from "vitest";
import { deliverFormJob, FormDeliveryError, type FormDeliveryJob, type FormDeliveryResult } from "../index.js";

const job: FormDeliveryJob = {
  binding: { bindingId: "b-1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: { table: "leads" } },
  snapshot: { form: { slug: "contact", fields: [{ name: "email", required: true }] },
    submission: { id: "s-1", answers: { email: "a@example.test" }, submittedAt: "2026-10-20T00:00:00.000Z" } },
  idempotencyKey: JSON.stringify(["s-1", "b-1"]),
};

async function failureOf(result: unknown): Promise<unknown> {
  // `result` is untyped on purpose: plugin adapters are plain `.mjs` and may return anything.
  return deliverFormJob({ job, deliver: async () => result as FormDeliveryResult }).then(() => "resolved", (error: unknown) => error);
}

describe("success", () => {
  test("hands the frozen job to deliver unchanged", async () => {
    const seen: FormDeliveryJob[] = [];
    await deliverFormJob({ job, readSubmission: async () => { throw new Error("legacy jobs must not read a source"); }, deliver: async input => { seen.push(input); } });
    expect(seen).toEqual([job]);
    expect(seen[0]).toBe(job);
  });

  test("a legacy adapter that returns nothing succeeds", async () => {
    await expect(deliverFormJob({ job, deliver: async () => undefined })).resolves.toBeUndefined();
  });

  test("{ ok: true } with a reference succeeds", async () => {
    await expect(deliverFormJob({ job, deliver: async () => ({ ok: true, reference: "row-9" }) })).resolves.toBeUndefined();
  });
});

describe("referenced sources", () => {
  const referenced = { binding: job.binding, form: job.snapshot.form,
    submissionRef: { submissionId: "s-1", formId: "f-1" }, idempotencyKey: job.idempotencyKey };

  test("reads current answers on every attempt and retains frozen form and binding metadata", async () => {
    const delivered: FormDeliveryJob[] = [];
    const reads: unknown[] = [];
    let source = job.snapshot.submission;
    const attempt = () => deliverFormJob({ job: referenced, workspaceId: "w-1",
      readSubmission: async input => { reads.push(input); return source; },
      deliver: async input => { delivered.push(input); } });
    await attempt();
    source = { ...source, answers: { email: "updated@example.test" } };
    await attempt();
    expect(reads).toEqual(Array(2).fill({ workspaceId: "w-1", submissionId: "s-1", formId: "f-1" }));
    expect(delivered).toEqual([job, { ...job, snapshot: { ...job.snapshot, submission: source } }]);
    expect(JSON.stringify(referenced)).not.toContain("answers");
  });

  test("a purged source stops delivery permanently", async () => {
    let calls = 0;
    await expect(deliverFormJob({ job: referenced, workspaceId: "w-1", readSubmission: async () => null,
      deliver: async () => { calls++; } })).rejects.toMatchObject({ code: "delivery-failed", retryable: false });
    expect(calls).toBe(0);
  });

  test("missing source wiring fails permanently before reaching the adapter", async () => {
    let calls = 0;
    await expect(deliverFormJob({ job: referenced, deliver: async () => { calls++; } }))
      .rejects.toMatchObject({ code: "configuration-invalid", retryable: false });
    expect(calls).toBe(0);
  });

  test("a reader returning another submission stops delivery", async () => {
    let calls = 0;
    await expect(deliverFormJob({ job: referenced, workspaceId: "w-1",
      readSubmission: async () => ({ ...job.snapshot.submission, id: "another-submission" }),
      deliver: async () => { calls++; } })).rejects.toMatchObject({ code: "delivery-failed", retryable: false });
    expect(calls).toBe(0);
  });

  test("a failed source read retries with no provider call or private error text", async () => {
    let calls = 0;
    await expect(deliverFormJob({ job: referenced, workspaceId: "w-1", readSubmission: async () => { throw new Error("private data"); },
      deliver: async () => { calls++; } })).rejects.toMatchObject({ message: "delivery-failed", retryable: true });
    expect(calls).toBe(0);
  });
});

describe("failure from a result", () => {
  test("{ ok: false } with an allowlisted terminal code throws that code as non-retryable", async () => {
    const error = await failureOf({ ok: false, error: { code: "authorization-required", retryable: false } });
    expect(error).toBeInstanceOf(FormDeliveryError);
    expect([(error as FormDeliveryError).code, (error as FormDeliveryError).retryable]).toEqual(["authorization-required", false]);
  });

  test.each([
    ["null", null],
    ["{ ok: false } without an error", { ok: false }],
    ["an error that is a string", { ok: false, error: "quota exceeded for token" }],
    ["a truthy ok that is not true", { ok: "yes" }],
    ["a bare string", "done"],
  ])("%s becomes retryable delivery-failed", async (_label, result) => {
    const error = await failureOf(result);
    expect(error).toBeInstanceOf(FormDeliveryError);
    expect([(error as FormDeliveryError).message, (error as FormDeliveryError).retryable]).toEqual(["delivery-failed", true]);
  });
});

describe("failure from a throw", () => {
  test("a thrown FormDeliveryError passes through as the same instance", async () => {
    const thrown = new FormDeliveryError({ code: "adapter-unavailable", retryable: true });
    const error = await deliverFormJob({ job, deliver: async () => { throw thrown; } }).then(() => undefined, (e: unknown) => e);
    expect(error).toBe(thrown);
  });

  test("a thrown non-Error value becomes retryable delivery-failed", async () => {
    const error = await deliverFormJob({ job, deliver: async () => { throw "socket hang up"; } }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(FormDeliveryError);
    expect([(error as FormDeliveryError).code, (error as FormDeliveryError).retryable]).toEqual(["delivery-failed", true]);
  });

  test("a deliver that throws synchronously is still normalised", async () => {
    const deliver = (): Promise<void> => { throw new TypeError("adapter.deliver is not a function"); };
    const error = await deliverFormJob({ job, deliver }).then(() => undefined, (e: unknown) => e);
    expect((error as FormDeliveryError).message).toBe("delivery-failed");
  });
});

/**
 * @file Security pins for form delivery (phase A): adapter and host error text must never reach
 * the outbox ledger or a status read, only an allowlisted code; and the idempotency key a
 * destination dedupes on must not change between plans, retries or replays.
 */
import { describe, expect, test } from "vitest";
import {
  deliverFormJob,
  FormDeliveryError,
  formDeliveryStatusFromOutbox,
  planFormDeliveries,
  type FormDeliveryBinding,
  type FormDeliveryJob,
  type FormDeliveryPlan,
  type FormDeliveryPlanPort,
  type FormDeliveryResult,
} from "../index.js";

const binding: FormDeliveryBinding = { bindingId: "b-1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: {} };
const job: FormDeliveryJob = {
  binding,
  snapshot: { form: { slug: "contact", fields: [] }, submission: { id: "s-1", answers: {}, submittedAt: "2026-10-20T00:00:00.000Z" } },
  idempotencyKey: "key",
};
// Built at runtime so no secret-shaped literal is committed.
const secret = () => "Bearer " + "gh" + "p_" + "x".repeat(36);

async function failureOf(deliver: () => Promise<FormDeliveryResult | void>): Promise<FormDeliveryError> {
  const error = await deliverFormJob({ job, deliver }).then(() => undefined, (e: unknown) => e);
  if (!(error instanceof FormDeliveryError)) throw new Error("expected a FormDeliveryError");
  return error;
}

describe("error-code allowlist", () => {
  test("a thrown error with a secret-looking message leaves only the code", async () => {
    const error = await failureOf(async () => { throw new Error(`upstream said ${secret()}`); });
    expect(error.message).toBe("delivery-failed");
    expect(error.code).toBe("delivery-failed");
    expect(error.retryable).toBe(true);
    expect(JSON.stringify({ ...error, message: error.message, stack: undefined })).not.toContain("x".repeat(36));
    expect(error.cause).toBeUndefined();
  });

  test("an unknown result code becomes retryable delivery-failed", async () => {
    // Malformed on purpose: plain-object adapters are not type-checked.
    const result = { ok: false, error: { code: secret(), retryable: false } } as unknown as FormDeliveryResult;
    const error = await failureOf(async () => result);
    expect([error.message, error.code, error.retryable]).toEqual(["delivery-failed", "delivery-failed", true]);
  });

  test("an allowlisted result code passes through with its retry hints and no adapter text", async () => {
    const error = await failureOf(async () => ({ ok: false, error: { code: "rate-limited", retryable: true, retryAfterMs: 5_000, outcome: "not-applied" } }));
    expect([error.message, error.code, error.retryable, error.retryAfterMs, error.outcome]).toEqual(["rate-limited", "rate-limited", true, 5_000, "not-applied"]);
  });

  test("a host-thrown FormDeliveryError built from an unknown code is still reduced to delivery-failed", () => {
    const error = new FormDeliveryError({ code: secret(), retryable: false });
    expect([error.message, error.code, error.retryable]).toEqual(["delivery-failed", "delivery-failed", true]);
  });

  test("a status read exposes only an allowlisted code, never the ledger's raw text", () => {
    const status = formDeliveryStatusFromOutbox({ row: { status: "pending", attempts: 2, nextAttemptAt: "2026-10-20T00:05:00.000Z", lastError: `timeout ${secret()}` } });
    expect(status.errorCode).toBe("delivery-failed");
    expect(JSON.stringify(status)).not.toContain("x".repeat(36));
  });
});

describe("idempotency key", () => {
  class Plans implements FormDeliveryPlanPort {
    stored: FormDeliveryPlan | undefined;
    async once(input: Parameters<FormDeliveryPlanPort["once"]>[0]): Promise<FormDeliveryPlan> {
      this.stored ??= structuredClone(await input.build());
      return structuredClone(this.stored);
    }
  }
  const plan = (plans: FormDeliveryPlanPort, ids: () => string) => planFormDeliveries({
    workspaceId: "w", submissionId: "s-1", formId: "f-1",
    deps: { plans, bindings: async () => [binding], snapshot: async () => job.snapshot, newId: ids, nowIso: () => "2026-10-20T00:00:00.000Z" },
  });

  test("is identical across independent plans of the same submission and binding while job ids differ", async () => {
    let n = 0;
    const first = await plan(new Plans(), () => `job-${++n}`);
    const second = await plan(new Plans(), () => `job-${++n}`);
    expect(second.jobs[0]!.payload.idempotencyKey).toBe(first.jobs[0]!.payload.idempotencyKey);
    expect(second.jobs[0]!.id).not.toBe(first.jobs[0]!.id);
  });

  test("is passed unchanged to the adapter on every retry", async () => {
    const seen: string[] = [];
    const deliver = async (input: FormDeliveryJob) => { seen.push(input.idempotencyKey); throw new Error("offline"); };
    for (let attempt = 0; attempt < 3; attempt++) await deliverFormJob({ job, deliver }).catch(() => undefined);
    expect(seen).toEqual(["key", "key", "key"]);
  });
});

describe("frozen snapshot", () => {
  test("never carries the source IP even when the host snapshot reader returns it", async () => {
    // Malformed on purpose: a host reader that returns the raw stored row.
    const leaky = { ...job.snapshot, submission: { ...job.snapshot.submission, sourceIp: "203.0.113.9" } };
    const plans: FormDeliveryPlanPort = { once: async ({ build }) => build() };
    const result = await planFormDeliveries({ workspaceId: "w", submissionId: "s-1", formId: "f-1",
      deps: { plans, bindings: async () => [binding], snapshot: async () => leaky, newId: () => "j", nowIso: () => "now" } });
    expect(JSON.stringify(result)).not.toContain("203.0.113.9");
  });
});

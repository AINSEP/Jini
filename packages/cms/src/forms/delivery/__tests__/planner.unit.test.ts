/**
 * @file Unit tests for the planner: which bindings a submission selects, what the frozen child jobs
 * contain, and that a stored plan is reused rather than rebuilt (contract §5).
 */
import { describe, expect, test } from "vitest";
import {
  FORM_DELIVERY_EVENT,
  planFormDeliveries,
  type FormDeliveryBinding,
  type FormDeliveryPlan,
  type FormDeliveryPlannerDeps,
  type FormDeliveryPlanPort,
  type FormDeliverySnapshot,
} from "../index.js";

const NOW = "2026-10-20T12:00:00.000Z";
const binding = (bindingId: string, patch: Partial<FormDeliveryBinding> = {}): FormDeliveryBinding =>
  ({ bindingId, adapterId: "rows", connectionRef: `conn-${bindingId}`, enabled: true, config: { table: bindingId }, ...patch });
const snapshot: FormDeliverySnapshot = {
  form: { slug: "contact", fields: [{ name: "email", required: true, label: "Email", type: "email" }] },
  submission: { id: "s-1", answers: { email: "a@example.test" }, submittedAt: "2026-10-20T11:59:00.000Z" },
};

/** Typed fake of the host plan store: stores the first built plan per (workspace, submission). */
class MemoryPlans implements FormDeliveryPlanPort {
  readonly stored = new Map<string, FormDeliveryPlan>();
  builds = 0;
  async once(required: { workspaceId: string; submissionId: string; build: () => Promise<FormDeliveryPlan> }): Promise<FormDeliveryPlan> {
    const key = JSON.stringify([required.workspaceId, required.submissionId]);
    const existing = this.stored.get(key);
    if (existing) return existing;
    this.builds++;
    const plan = await required.build();
    this.stored.set(key, plan);
    return plan;
  }
}

function setup(bindings: FormDeliveryBinding[], source: FormDeliverySnapshot | null = snapshot) {
  const calls = { snapshot: [] as Array<{ workspaceId: string; submissionId: string; formId: string }>, bindings: [] as string[], now: 0 };
  let id = 0;
  const plans = new MemoryPlans();
  const deps: FormDeliveryPlannerDeps = {
    plans,
    bindings: async ({ workspaceId }) => { calls.bindings.push(workspaceId); return bindings; },
    snapshot: async input => { calls.snapshot.push(input); return source; },
    newId: () => `job-${++id}`,
    nowIso: () => { calls.now++; return NOW; },
  };
  const plan = (submissionId = "s-1") => planFormDeliveries({ deps, workspaceId: "w-1", submissionId, formId: "f-1" });
  return { deps, plans, calls, plan };
}

describe("selection", () => {
  test("a binding without formIds selects every form", async () => {
    const { plan } = setup([binding("all")]);
    expect((await plan()).jobs.map(job => job.payload.binding.bindingId)).toEqual(["all"]);
  });

  test("a binding listing the form selects it", async () => {
    const { plan } = setup([binding("listed", { formIds: ["other", "f-1"] })]);
    expect((await plan()).jobs).toHaveLength(1);
  });

  test("a binding listing only other forms does not select it", async () => {
    const { plan } = setup([binding("elsewhere", { formIds: ["other"] })]);
    expect((await plan()).jobs).toEqual([]);
  });

  test("a binding with an empty formIds list selects no form", async () => {
    const { plan } = setup([binding("none", { formIds: [] })]);
    expect((await plan()).jobs).toEqual([]);
  });

  test("a disabled binding is skipped even when it lists the form", async () => {
    const { plan } = setup([binding("off", { enabled: false, formIds: ["f-1"] })]);
    expect((await plan()).jobs).toEqual([]);
  });

  test("reads bindings of the event's workspace", async () => {
    const { plan, calls } = setup([]);
    await plan();
    expect(calls.bindings).toEqual(["w-1"]);
  });
});

describe("empty selection", () => {
  test("records a plan with no jobs and never reads the snapshot", async () => {
    const { plan, plans, calls } = setup([binding("off", { enabled: false })]);
    expect(await plan()).toEqual({ workspaceId: "w-1", submissionId: "s-1", formId: "f-1", jobs: [] });
    expect(plans.stored.size).toBe(1);
    expect(calls.snapshot).toEqual([]);
  });

  test("a binding added after an empty plan never backfills that submission", async () => {
    const bindings: FormDeliveryBinding[] = [];
    const { plan } = setup(bindings);
    await plan();
    bindings.push(binding("late"));
    expect((await plan()).jobs).toEqual([]);
  });
});

describe("frozen jobs", () => {
  test("one child job per selected binding, with its own id, the event name, and one shared timestamp", async () => {
    const { plan, calls } = setup([binding("a"), binding("skip", { enabled: false }), binding("b")]);
    const result = await plan();
    expect(result.jobs.map(({ id, name, workspaceId, aggregateId, occurredAt }) => ({ id, name, workspaceId, aggregateId, occurredAt }))).toEqual([
      { id: "job-1", name: FORM_DELIVERY_EVENT, workspaceId: "w-1", aggregateId: "s-1", occurredAt: NOW },
      { id: "job-2", name: FORM_DELIVERY_EVENT, workspaceId: "w-1", aggregateId: "s-1", occurredAt: NOW },
    ]);
    expect(calls.now).toBe(1);
  });

  test("each payload carries its binding, the snapshot and a key built from (submissionId, bindingId)", async () => {
    const { plan } = setup([binding("a"), binding("b")]);
    const [first, second] = (await plan()).jobs;
    expect(first!.payload).toEqual({ binding: binding("a"), snapshot, idempotencyKey: '["s-1","a"]' });
    expect(second!.payload.idempotencyKey).toBe('["s-1","b"]');
  });

  test("the key cannot collide when ids contain the separator a joined string would use", async () => {
    // "s-1:x" + "y" and "s-1" + "x:y" would both join to "s-1:x:y".
    const [left] = (await setup([binding("y")]).plan("s-1:x")).jobs;
    const [right] = (await setup([binding("x:y")]).plan("s-1")).jobs;
    expect(left!.payload.idempotencyKey).not.toBe(right!.payload.idempotencyKey);
  });

  test("reads the snapshot for the event's workspace, submission and form", async () => {
    const { plan, calls } = setup([binding("a")]);
    await plan();
    expect(calls.snapshot).toEqual([{ workspaceId: "w-1", submissionId: "s-1", formId: "f-1" }]);
  });

  test("copies only the delivered form and submission fields from a wider host row", async () => {
    // Malformed on purpose: a host reader that returns whole stored rows.
    const wide = {
      form: { ...snapshot.form, notify: { recipients: ["owner@example.test"] }, status: "active" },
      submission: { ...snapshot.submission, sourceIp: "198.51.100.7", formDefinitionId: "f-1" },
      extra: "unexpected",
    } as FormDeliverySnapshot;
    const { plan } = setup([binding("a")], wide);
    expect((await plan()).jobs[0]!.payload.snapshot).toEqual(snapshot);
  });
});

describe("missing source", () => {
  test("throws naming the submission and form when bindings matched but the snapshot is gone", async () => {
    const { plan, plans } = setup([binding("a")], null);
    await expect(plan()).rejects.toThrow(
      "Form delivery planning failed: submission s-1 or form f-1 was not found; the source event will retry.");
    expect(plans.stored.size).toBe(0);
  });
});

describe("replay", () => {
  test("returns the stored plan, unchanged, after the bindings changed", async () => {
    const bindings = [binding("a")];
    const { plan, plans } = setup(bindings);
    const first = await plan();
    bindings.splice(0, 1, binding("b"));
    const replay = await plan();
    expect(replay).toEqual(first);
    expect(replay.jobs.map(job => job.id)).toEqual(["job-1"]);
    expect(plans.builds).toBe(1);
  });

  test("asks the plan store by workspace and submission", async () => {
    const seen: Array<{ workspaceId: string; submissionId: string }> = [];
    const { deps } = setup([]);
    const plans: FormDeliveryPlanPort = { once: async ({ workspaceId, submissionId, build }) => { seen.push({ workspaceId, submissionId }); return build(); } };
    await planFormDeliveries({ deps: { ...deps, plans }, workspaceId: "w-2", submissionId: "s-9", formId: "f-1" });
    expect(seen).toEqual([{ workspaceId: "w-2", submissionId: "s-9" }]);
  });
});

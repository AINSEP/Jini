import assert from "node:assert/strict";
import { test, type NodeTestContext } from "./support/node-test.fixture.js";

import { InMemoryEventBus, InMemoryOutbox } from "./support/switch-bindings.fixture.js";
import { createRateLimiter } from "./support/switch-bindings.fixture.js";
import { FormDefinitionNotFoundError, FormRateLimitExceededError, FormSubmissionValidationError } from "../index.js";
import { FORMS_SUBMIT_PROFILE } from "./support/switch-bindings.fixture.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "../repo.memory.js";
import { submitForm } from "./support/switch-bindings.fixture.js";
import { createSubmissionAttempts, DUPLICATE_ATTEMPT, DUPLICATE_SUBMISSION_WINDOW_MS, FORM_ATTEMPT_FIELD, submissionAttemptKey } from "./support/switch-bindings.fixture.js";
import type { DomainEvent } from "../../core/index.js";
import type { FormDefinitionRecord } from "../index.js";

/**
 * @file Integration-style tests for `submitForm` (C-008, REQ-05..09/16, AC-08/09/10/13/14/15/24,
 * INV-01/04/05/07, EC-09) against real (in-memory) contracts — honeypot silent-discard with
 * identical response shape, payload validation rejects, rate-limit rejects, accepted submission
 * persists + enqueues exactly once, and the fire-and-forget timing assertion (AC-24/INV-05).
 */

const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";

function makeDefinition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "def-1",
    workspaceId: WORKSPACE_ID,
    name: "Contact",
    slug: "contact",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "email", label: "Email", type: "email", required: true },
    ],
    notify: { enabled: false, recipients: [] },
    version: 1,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDeps() {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const outbox = new InMemoryOutbox();
  const bus = new InMemoryEventBus();
  const clock = { nowMs: () => Date.parse(NOW) };
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  const rateLimiter = createRateLimiter({ profile: FORMS_SUBMIT_PROFILE, clock });
  return { definitionRepo, submissionRepo, outbox, bus, clock, idGen, rateLimiter };
}

test("submitForm: AC-07/REQ-05 — accepts a valid submission to an active form", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });
  assert.equal(result.status, "accepted");
});

test("submitForm: AC-15/REQ-10 — persists the submission with field values, source IP, timestamp", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 1);
  assert.ok(page.items[0]);
  assert.deepEqual(page.items[0].data, { name: "Ada", email: "ada@example.com" });
  assert.equal(page.items[0].sourceIp, "1.1.1.1");
  assert.equal(page.items[0].submittedAt, NOW);
});

test("submitForm: AC-11/REQ-07 — rejects a nonexistent slug with FormDefinitionNotFoundError", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      submitForm({
        deps,
        input: { workspaceId: WORKSPACE_ID, slug: "nope", body: {}, sourceIp: "1.1.1.1" },
      }),
    FormDefinitionNotFoundError
  );
});

test("submitForm: AC-12/REQ-07/EC-03 — rejects a disabled slug with the identical FormDefinitionNotFoundError", async () => {
  const deps = makeDeps();
  let missingMessage: string | undefined;
  await assert.rejects(() => submitForm({ deps, input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" } }), (error: unknown) => {
    assert.ok(error instanceof FormDefinitionNotFoundError);
    missingMessage = error.message;
    return true;
  });
  await deps.definitionRepo.create(makeDefinition({ status: "disabled" }));
  await assert.rejects(
    () =>
      submitForm({
        deps,
        input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof FormDefinitionNotFoundError);
      assert.equal(error.message, missingMessage);
      return true;
    }
  );
});

test("submitForm: AC-08/09/10 — rejects an invalid payload with FormSubmissionValidationError, nothing persisted", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  await assert.rejects(
    () =>
      submitForm({
        deps,
        input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada" }, sourceIp: "1.1.1.1" },
      }),
    FormSubmissionValidationError
  );

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 0);
});

test("submitForm: AC-13/INV-04 — a honeypot-tripped submission returns accepted but persists nothing and enqueues nothing", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      slug: "contact",
      body: { name: "Ada", email: "ada@example.com", _hp: "i-am-a-bot" },
      sourceIp: "1.1.1.1",
    },
  });
  assert.equal(result.status, "accepted");

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 0);

  const claimed = await deps.outbox.claimPending(20, NOW);
  assert.equal(claimed.length, 0);
});

test("submitForm: EC-09 — a whitespace-only honeypot field is treated as normal (not tripped)", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const result = await submitForm({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      slug: "contact",
      body: { name: "Ada", email: "ada@example.com", _hp: "   " },
      sourceIp: "1.1.1.1",
    },
  });
  assert.equal(result.status, "accepted");

  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 1);
});

test("submitForm: AC-14/REQ-09 — the 6th submission in-window from the same (ip, formId) is rate-limited", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const body = { name: "Ada", email: "ada@example.com" };

  for (let i = 0; i < 5; i++) {
    const result = await submitForm({
      deps,
      input: { workspaceId: WORKSPACE_ID, slug: "contact", body, sourceIp: "2.2.2.2" },
    });
    assert.equal(result.status, "accepted");
  }

  await assert.rejects(
    () => submitForm({ deps, input: { workspaceId: WORKSPACE_ID, slug: "contact", body, sourceIp: "2.2.2.2" } }),
    FormRateLimitExceededError
  );
});

test("submitForm: INV-07 — enqueues exactly one form.submission.received event per accepted submission", { timeout: 2000 }, async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  const received: DomainEvent<unknown>[] = [];
  const enqueued: DomainEvent[] = [];
  const enqueue = deps.outbox.enqueue.bind(deps.outbox);
  t.mock.method(deps.outbox, "enqueue", async (event: DomainEvent) => { enqueued.push(structuredClone(event)); await enqueue(event); });
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => { delivered = resolve; });
  const markDelivered = deps.outbox.markDelivered.bind(deps.outbox);
  t.mock.method(deps.outbox, "markDelivered", async (input: { id: string }) => { await markDelivered(input); delivered(); });
  await deps.bus.subscribe({ eventName: "form.submission.received", handler: async (event) => {
    received.push(event);
  } });

  await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "1.1.1.1" },
  });

  await delivery;

  assert.equal(enqueued.length, 1);
  assert.deepEqual(received, enqueued);
  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 10 });
  assert.equal(page.items.length, 1);
  const submission = page.items[0]!;
  assert.deepEqual(received[0], { id: "id-2", name: "form.submission.received", workspaceId: WORKSPACE_ID, aggregateId: submission.id, occurredAt: NOW, payload: { workspaceId: WORKSPACE_ID, formDefinitionId: submission.formDefinitionId, submissionId: submission.id } });
});

test("submitForm: AC-24/INV-05 — the response resolves before a slow/throwing subscriber settles (fire-and-forget outbox drain)", { timeout: 2000 }, async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  let subscriberSettled = false;
  let entered!: () => void;
  const subscriberEntered = new Promise<void>((resolve) => { entered = resolve; });
  let settled!: () => void;
  const subscriberDone = new Promise<void>((resolve) => { settled = resolve; });
  let releaseSubscriber: () => void = () => {};
  const hang = new Promise<void>((resolve) => {
    releaseSubscriber = resolve;
  });
  await deps.bus.subscribe({ eventName: "form.submission.received", handler: async () => {
    entered();
    await hang;
    subscriberSettled = true;
    settled();
    throw new Error("simulated slow/throwing MailerPort.send()");
  } });

  t.after(() => releaseSubscriber());
  const result = await submitForm({
    deps,
    input: { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "ada@example.com" }, sourceIp: "3.3.3.3" },
  });

  assert.equal(result.status, "accepted");
  await subscriberEntered;
  assert.equal(subscriberSettled, false, "submitForm must not wait for the subscriber to settle");

  releaseSubscriber();
  await subscriberDone;
  assert.equal(subscriberSettled, true, "the subscriber eventually runs, just not before the response");
});

// ---------------------------------------------------------------------------
// Double-submit dedupe: a double-clicked Send (the same attempt token posted twice) must store ONE
// submission and answer both alike; distinct attempts must never be silently dropped.
// ---------------------------------------------------------------------------

async function storedSubmissions(deps: ReturnType<typeof makeDeps>) {
  return (await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: "def-1", limit: 50 })).items;
}

function makeClockedDeps(startMs: number) {
  const deps = makeDeps();
  let nowMs = startMs;
  const clock = { nowMs: () => nowMs };
  return { deps: { ...deps, clock, rateLimiter: createRateLimiter({ profile: FORMS_SUBMIT_PROFILE, clock }) }, advance: (ms: number) => { nowMs += ms; } };
}

function recordEnqueued(t: Pick<NodeTestContext, "mock">, deps: ReturnType<typeof makeDeps>): DomainEvent[] {
  const enqueued: DomainEvent[] = [];
  const enqueue = deps.outbox.enqueue.bind(deps.outbox);
  t.mock.method(deps.outbox, "enqueue", async (event: DomainEvent) => { enqueued.push(event); await enqueue(event); });
  return enqueued;
}

const ADA = { name: "Ada", email: "ada@example.com" };
const attempt = (token: string, sourceIp = "4.4.4.4") => ({ workspaceId: WORKSPACE_ID, slug: "contact", body: { ...ADA, [FORM_ATTEMPT_FIELD]: token }, sourceIp });

test("submitForm: a double-clicked Send (one attempt token, posted twice at once) stores one row and one event, answers both accepted", async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const enqueued = recordEnqueued(t, deps);

  const results = await Promise.all([submitForm({ deps, input: attempt("tok-1") }), submitForm({ deps, input: attempt("tok-1") })]);

  assert.deepEqual(results, [{ status: "accepted" }, { status: "accepted" }]);
  const rows = await storedSubmissions(deps);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.data, ADA, "the attempt token is never stored");
  assert.deepEqual(enqueued.map((e) => e.aggregateId), [rows[0]!.id]);
});

test("submitForm: two visitors behind one NAT sending the same answer from different page loads both get a row", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  await submitForm({ deps, input: attempt("tok-visitor-a", "9.9.9.9") });
  await submitForm({ deps, input: attempt("tok-visitor-b", "9.9.9.9") });

  assert.equal((await storedSubmissions(deps)).length, 2);
});

test("submitForm: the stored id and the event's aggregate are the random idGen ids, nothing derived from the visitor", async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const enqueued = recordEnqueued(t, deps);

  await submitForm({ deps, input: attempt("tok-1") });

  assert.deepEqual((await storedSubmissions(deps)).map((row) => row.id), ["id-1"]);
  assert.deepEqual(enqueued.map((e) => [e.id, e.aggregateId, (e.payload as { submissionId: string }).submissionId]), [["id-2", "id-1", "id-1"]]);
});

test("submitForm: a repeat is suppressed for the window measured from acceptance — 64s later is a new row, whatever the minute", async () => {
  const minute = 60_000;
  const { deps, advance } = makeClockedDeps(1000 * minute + 1000);
  await deps.definitionRepo.create(makeDefinition());
  const input = { workspaceId: WORKSPACE_ID, slug: "contact", body: ADA, sourceIp: "4.4.4.4" };

  await submitForm({ deps, input });
  advance(DUPLICATE_SUBMISSION_WINDOW_MS - 1);
  await submitForm({ deps, input });
  assert.equal((await storedSubmissions(deps)).length, 1, "inside the window: the same submission");
  advance(4001);
  await submitForm({ deps, input });
  assert.equal((await storedSubmissions(deps)).length, 2, "64s after the first: a new submission");
});

test("submitForm: concurrent copies straddling a minute boundary still store one row, even when the first pauses before its insert", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  // The first copy reads the clock just before a minute boundary, the second just after it.
  const boundary = 1000 * 60_000;
  let reads = 0;
  const clock = { nowMs: () => (++reads <= 2 ? boundary - 1 : boundary + 1) };
  // The first insert stalls, so the second copy decides while the first row is not yet written.
  const repo = deps.submissionRepo;
  let stalled = false;
  const stallFirst = <A extends unknown[], R>(write: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    if (!stalled) { stalled = true; await new Promise((resolve) => setTimeout(resolve, 20)); }
    return write(...args);
  };
  const submissionRepo = new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      return (prop === "create" || prop === "createOnce") && typeof value === "function"
        ? stallFirst((value as (...args: unknown[]) => Promise<unknown>).bind(target))
        : value;
    },
  });
  const fixedClock = { nowMs: () => boundary };
  const clocked = { ...deps, submissionRepo, clock, rateLimiter: createRateLimiter({ profile: FORMS_SUBMIT_PROFILE, clock: fixedClock }) };
  const input = { workspaceId: WORKSPACE_ID, slug: "contact", body: ADA, sourceIp: "4.4.4.4" };

  const results = await Promise.all([submitForm({ deps: clocked, input }), submitForm({ deps: clocked, input })]);

  assert.deepEqual(results, [{ status: "accepted" }, { status: "accepted" }]);
  assert.equal((await storedSubmissions(deps)).length, 1);
});

test("submitForm: without a token, the same body from the same IP collapses; another IP, body or form does not", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  await deps.definitionRepo.create(makeDefinition({ id: "def-2", slug: "other" }));
  const input = { workspaceId: WORKSPACE_ID, slug: "contact", body: ADA, sourceIp: "4.4.4.4" };

  await submitForm({ deps, input });
  await submitForm({ deps, input });
  await submitForm({ deps, input: { ...input, body: { ...ADA, name: "Grace" } } });
  await submitForm({ deps, input: { ...input, sourceIp: "5.5.5.5" } });
  await submitForm({ deps, input: { ...input, slug: "other" } });

  assert.equal((await storedSubmissions(deps)).length, 3);
});

test("submitForm: a failed enqueue rolls the row back, and the retry of that same attempt stores it with its event", async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const enqueued: DomainEvent[] = [];
  const enqueue = deps.outbox.enqueue.bind(deps.outbox);
  let failNext = true;
  t.mock.method(deps.outbox, "enqueue", async (event: DomainEvent) => {
    if (failNext) { failNext = false; throw new Error("outbox unavailable"); }
    enqueued.push(event);
    await enqueue(event);
  });

  await assert.rejects(() => submitForm({ deps, input: attempt("tok-1") }), { message: "outbox unavailable" });
  assert.equal((await storedSubmissions(deps)).length, 0, "no submission without its event");

  assert.deepEqual(await submitForm({ deps, input: attempt("tok-1") }), { status: "accepted" });
  const rows = await storedSubmissions(deps);
  assert.equal(rows.length, 1);
  assert.deepEqual(enqueued.map((e) => e.aggregateId), [rows[0]!.id]);
});

test("submitForm: a copy waiting on a first copy that fails is stored itself, not answered accepted with nothing stored", async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  const enqueue = deps.outbox.enqueue.bind(deps.outbox);
  let calls = 0;
  t.mock.method(deps.outbox, "enqueue", async (event: DomainEvent) => {
    if (++calls === 1) throw new Error("outbox unavailable");
    await enqueue(event);
  });

  const [first, second] = await Promise.allSettled([submitForm({ deps, input: attempt("tok-1") }), submitForm({ deps, input: attempt("tok-1") })]);

  assert.equal(first.status, "rejected");
  assert.deepEqual(second, { status: "fulfilled", value: { status: "accepted" } });
  assert.equal((await storedSubmissions(deps)).length, 1);
});

test("submitForm: a refused request leaves no claim, so the same attempt is processed once the form exists", async () => {
  const deps = makeDeps();
  await assert.rejects(() => submitForm({ deps, input: attempt("tok-1") }), FormDefinitionNotFoundError);
  await deps.definitionRepo.create(makeDefinition());

  await submitForm({ deps, input: attempt("tok-1") });

  assert.equal((await storedSubmissions(deps)).length, 1);
});

test("submitForm: a repo failure propagates and stores nothing", async (t) => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());
  t.mock.method(deps.submissionRepo, "create", async () => { throw new Error("disk full"); });

  await assert.rejects(() => submitForm({ deps, input: attempt("tok-1") }), /disk full/);
});

test("submitForm: a duplicate still passes the rate check and consumes a slot, as any request does", async () => {
  const deps = makeDeps();
  await deps.definitionRepo.create(makeDefinition());

  for (let i = 0; i < 5; i++) assert.deepEqual(await submitForm({ deps, input: attempt("tok-1") }), { status: "accepted" });
  await assert.rejects(() => submitForm({ deps, input: attempt("tok-2") }), FormRateLimitExceededError);

  assert.equal((await storedSubmissions(deps)).length, 1);
});

test("submissionAttemptKey: body key order does not matter; workspace, slug, IP, token and body do", () => {
  const input = { workspaceId: WORKSPACE_ID, slug: "contact", body: { name: "Ada", email: "a@x.io" }, sourceIp: "4.4.4.4" };
  const key = submissionAttemptKey({ input, attemptToken: "t" });
  assert.equal(submissionAttemptKey({ input: { ...input, body: { email: "a@x.io", name: "Ada" } }, attemptToken: "t" }), key);
  for (const other of [
    { input: { ...input, workspaceId: "ws-2" }, attemptToken: "t" },
    { input: { ...input, slug: "other" }, attemptToken: "t" },
    { input: { ...input, sourceIp: "5.5.5.5" }, attemptToken: "t" },
    { input: { ...input, body: { name: "Ada", email: "b@x.io" } }, attemptToken: "t" },
    { input, attemptToken: "u" },
    { input, attemptToken: undefined },
  ]) assert.notEqual(submissionAttemptKey(other), key);
});

test("createSubmissionAttempts: past maxEntries the oldest claim is forgotten (a duplicate is stored, never a drop)", async () => {
  const attempts = createSubmissionAttempts({}, { maxEntries: 2 });
  const nowMs = () => 0;
  const ran: string[] = [];
  const run = (key: string) => attempts.once({ key, nowMs, submit: async () => { ran.push(key); return key; } });

  await run("a");
  await run("b");
  await run("c");
  assert.equal(await run("c"), DUPLICATE_ATTEMPT);
  await run("a");

  assert.deepEqual(ran, ["a", "b", "c", "a"]);
});

test("createSubmissionAttempts: expired claims are pruned as new ones arrive", async () => {
  const attempts = createSubmissionAttempts({}, { windowMs: 10, maxEntries: 2 });
  let now = 0;
  const ran: string[] = [];
  const run = (key: string) => attempts.once({ key, nowMs: () => now, submit: async () => { ran.push(key); return key; } });

  await run("a");
  now = 5;
  await run("b");
  now = 12;
  await run("c");
  assert.equal(await run("b"), DUPLICATE_ATTEMPT, "b (accepted at 5) is still inside its window at 12");

  assert.deepEqual(ran, ["a", "b", "c"]);
});

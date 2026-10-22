import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryOutbox } from "../../redirects/__tests__/support/events.fixture.js";
import { createCommentHookRegistry } from "../hooks.js";
import { createCommentIngressPolicy } from "../ingress.js";
import type { EntryLookupResult } from "../ingress.js";
import { InMemoryCommentRepo } from "../repo.memory.js";
import { HeuristicSpamCheck } from "../spam.heuristic.js";
import { COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID } from "../types.js";
import type { CommentsSettings, CommentSubmission } from "../types.js";
import type { CommentRateLimiter as RateLimiter } from "../ingress.js";
import type { CommentHookRegistry } from "../hooks.js";
import type { SpamCheckPort } from "../ports.js";

/** @file SPEC-033 — `CommentIngressPolicy`, one rejection reason at a time. */

const WORKSPACE_ID = "workspace-1";
const OPEN_ENTRY: EntryLookupResult = { id: "entry-1", commentsClosed: false };

function alwaysAllowRateLimiter(): RateLimiter {
  return { check: async ({ key: _key }) => ({ allowed: true }) };
}

function defaultSettings(overrides: Partial<CommentsSettings> = {}): CommentsSettings {
  return {
    enabled: true,
    requireModeration: true,
    maxDepth: 3,
    closeAfterDays: null,
    spamAutoRejectScore: 0.5,
    maxPerIpPerHour: 20,
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<CommentSubmission> = {}): CommentSubmission {
  return {
    workspaceId: WORKSPACE_ID,
    entryId: "entry-1",
    parentId: null,
    authorName: "Visitor",
    authorEmail: null,
    authorUrl: null,
    bodyRaw: "This is a normal comment.",
    authorPrincipalId: null,
    ingressContext: { authorIpHash: "hash-1" },
    ...overrides,
  };
}

function makePolicy(overrides: {
  settings?: Partial<CommentsSettings>;
  entryLookup?: (required: { workspaceId: string; entryId: string }) => Promise<EntryLookupResult | null>;
  rateLimiter?: RateLimiter;
  repo?: InMemoryCommentRepo;
  hooks?: CommentHookRegistry;
  spamCheck?: SpamCheckPort;
  outbox?: InMemoryOutbox;
} = {}) {
  const repo = overrides.repo ?? new InMemoryCommentRepo();
  return createCommentIngressPolicy({
    repo,
    spamCheck: overrides.spamCheck ?? new HeuristicSpamCheck(),
    hooks: overrides.hooks ?? createCommentHookRegistry(),
    clock: { nowMs: () => Date.parse("2026-07-16T00:00:00.000Z") },
    idGen: { newId: () => `comment-${Math.random().toString(36).slice(2)}` },
    getSettings: async () => defaultSettings(overrides.settings),
    entryLookup: overrides.entryLookup ?? (async () => OPEN_ENTRY),
    rateLimiter: overrides.rateLimiter ?? alwaysAllowRateLimiter(),
    outbox: overrides.outbox ?? new InMemoryOutbox(),
  });
}

test("a normal submission is accepted as pending (requireModeration: true)", async () => {
  const policy = makePolicy();
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.autoClassified, "pending");
    assert.equal(result.comment.status, "pending");
  }
});

test("requireModeration: false auto-approves a clean submission", async () => {
  const policy = makePolicy({ settings: { requireModeration: false } });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.autoClassified, "approved");
});

test("comments-disabled rejects before any repo/entry lookup", async () => {
  const policy = makePolicy({ settings: { enabled: false }, entryLookup: async () => { throw new Error("must not be called"); } });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "comments-disabled");
});

test("entry-not-found", async () => {
  const policy = makePolicy({ entryLookup: async () => null });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "entry-not-found");
});

test("entry-closed", async () => {
  const policy = makePolicy({ entryLookup: async () => ({ id: "entry-1", commentsClosed: true }) });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "entry-closed");
});

test("parent-not-found", async () => {
  const policy = makePolicy();
  const result = await policy.submit(makeSubmission({ parentId: "does-not-exist" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "parent-not-found");
});

/**
 * BUG REGRESSION (found auditing `submit()` for the complexity refactor, not introduced by it):
 * `CommentRepoPort.findById` is keyed only on `(workspaceId, id)`, not `entryId` — nothing checked
 * that a `parentId` actually belongs to the SAME entry as the submission. A submitter could supply
 * an open entry's id alongside a `parentId` that is really a comment on a totally different entry,
 * silently grafting the new comment onto that other entry's thread (wrong `threadRootId`, a
 * `depth` computed against an unrelated thread). This must be rejected exactly like any other
 * dangling parent id — see `ingress.ts`'s `resolveParentContext` for the fix.
 */
test("BUG REGRESSION: a parentId belonging to a DIFFERENT entry is rejected as parent-not-found, not silently grafted onto its thread", async () => {
  const repo = new InMemoryCommentRepo();
  await repo.create({ record: {
    id: "other-entry-root",
    workspaceId: WORKSPACE_ID,
    entryId: "entry-OTHER", // a different entry than OPEN_ENTRY ("entry-1")
    parentId: null,
    threadRootId: "other-entry-root",
    depth: 0,
    status: "approved",
    authorPrincipalId: null,
    authorName: "x",
    authorEmail: null,
    authorUrl: null,
    authorIpHash: null,
    bodyText: "x",
    spamScore: null,
    spamProvider: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 0,
  } }, {});

  const policy = makePolicy({ repo });
  const result = await policy.submit(makeSubmission({ entryId: "entry-1", parentId: "other-entry-root" }));
  assert.equal(result.ok, false, "a cross-entry parentId must be rejected, not accepted as a valid parent");
  if (!result.ok) assert.equal(result.reason, "parent-not-found");
});

test("max-depth-exceeded", async () => {
  const repo = new InMemoryCommentRepo();
  await repo.create({ record: {
    id: "deep-parent",
    workspaceId: WORKSPACE_ID,
    entryId: "entry-1",
    parentId: null,
    threadRootId: "deep-parent",
    depth: 3, // at the max already (maxDepth: 3 in defaultSettings)
    status: "approved",
    authorPrincipalId: null,
    authorName: "x",
    authorEmail: null,
    authorUrl: null,
    authorIpHash: null,
    bodyText: "x",
    spamScore: null,
    spamProvider: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 0,
  } }, {});
  const policy = makePolicy({ repo });
  const result = await policy.submit(makeSubmission({ parentId: "deep-parent" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "max-depth-exceeded");
});

test("rate-limited", async () => {
  const policy = makePolicy({ rateLimiter: { check: async ({ key: _key }) => ({ allowed: false, retryAfterSeconds: 60 }) } });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "rate-limited");
});

test("body-too-large", async () => {
  const policy = makePolicy();
  const result = await policy.submit(makeSubmission({ bodyRaw: "x".repeat(20_000) }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "body-too-large");
});

test("too-many-links", async () => {
  const policy = makePolicy();
  const manyLinks = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`).join(" ");
  const result = await policy.submit(makeSubmission({ bodyRaw: manyLinks }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "too-many-links");
});

test("body and link caps accept the limit and reject one above it", async () => {
  for (const [bodyRaw, expected] of [
    ["x".repeat(10_000), { ok: true }],
    ["x".repeat(10_001), { ok: false, reason: "body-too-large" }],
    [Array.from({ length: 5 }, (_, i) => `https://example.com/${i}`).join(" "), { ok: true }],
    [Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`).join(" "), { ok: false, reason: "too-many-links" }],
  ] as const) {
    const result = await makePolicy().submit(makeSubmission({ bodyRaw }));
    assert.equal(result.ok, expected.ok);
    if (!result.ok && !expected.ok) assert.equal(result.reason, expected.reason);
  }
});

test("rate-limit buckets use the submission's author IP hash independently", async () => {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const policy = makePolicy({ rateLimiter: { check: async ({ key }) => {
    calls.push(key);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= 1 ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
  } } });
  assert.equal((await policy.submit(makeSubmission())).ok, true);
  assert.deepEqual(await policy.submit(makeSubmission()), { ok: false, reason: "rate-limited" });
  assert.equal((await policy.submit(makeSubmission({ ingressContext: { authorIpHash: "hash-2" } }))).ok, true);
  assert.equal((await policy.submit(makeSubmission({ ingressContext: {} }))).ok, true);
  assert.deepEqual(calls, ["hash-1", "hash-1", "hash-2", "unknown"]);
});

test("spam classification respects configured thresholds and equality", async () => {
  for (const [threshold, score, status] of [[1, 0, "pending"], [1, 0.7, "pending"], [0, 0, "spam"], [0.75, 0.75, "spam"], [0.75, 0.74, "pending"]] as const) {
    const policy = makePolicy({ settings: { spamAutoRejectScore: threshold }, spamCheck: {
      check: async () => ({ score, isSpam: score >= 0.5, provider: "fixture" }), report: async () => {},
    } });
    const result = await policy.submit(makeSubmission());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.autoClassified, status);
      assert.equal(result.comment.status, status);
    }
  }
});

test("before-submit transformations reach persistence and the spam checker", async () => {
  const hooks = createCommentHookRegistry();
  hooks.registerBeforeSubmitHook({ hook: async ({ submission }) => ({ submission: { ...submission, bodyRaw: "Filtered body", authorName: "Filtered visitor" } }) }, {});
  const repo = new InMemoryCommentRepo();
  let checkedBody = "";
  const policy = makePolicy({ hooks, repo, spamCheck: {
    check: async (submission) => { checkedBody = submission.bodyRaw; return { score: 0, isSpam: false, provider: "fixture" }; }, report: async () => {},
  } });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(checkedBody, "Filtered body");
  assert.equal(result.comment.bodyText, "Filtered body");
  assert.equal(result.comment.authorName, "Filtered visitor");
  assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: result.comment.id }), result.comment);
});

for (const mode of ["veto", "throw"] as const) {
  test(`before-submit ${mode} rejects without persistence or events`, async () => {
    const hooks = createCommentHookRegistry();
    hooks.registerBeforeSubmitHook({ hook: async () => {
      if (mode === "throw") throw new Error("filter failed");
      return { reject: "invalid" };
    } }, {});
    let laterHookRan = false;
    hooks.registerBeforeSubmitHook({ hook: async ({ submission }) => { laterHookRan = true; return { submission }; } }, {});
    const repo = new InMemoryCommentRepo();
    const outbox = new InMemoryOutbox();
    assert.deepEqual(await makePolicy({ hooks, repo, outbox }).submit(makeSubmission()), { ok: false, reason: "invalid" });
    assert.equal(laterHookRan, false, "must stop after rejection");
    for (const status of ["pending", "approved", "spam"] as const) assert.equal(await repo.countByStatus({ workspaceId: WORKSPACE_ID, status }), 0);
    assert.deepEqual(await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T00:00:00.000Z" }), []);
  });
}

test("successful submissions enqueue a scoped comments.submitted event with their classification", async () => {
  for (const status of ["pending", "approved", "spam"] as const) {
    const outbox = new InMemoryOutbox();
    const policy = makePolicy({ outbox, settings: { requireModeration: status !== "approved", spamAutoRejectScore: status === "spam" ? 0 : 1 } });
    const result = await policy.submit(makeSubmission());
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    const events = (await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T00:00:00.000Z" })).map((row) => row.event);
    assert.equal(events.length, 1);
    assert.ok(events[0]);
    assert.equal(events[0].name, "comments.submitted");
    assert.equal(events[0].workspaceId, WORKSPACE_ID);
    assert.equal(events[0].aggregateId, result.comment.id);
    assert.equal(events[0].occurredAt, "2026-07-16T00:00:00.000Z");
    assert.deepEqual(events[0].payload, { commentId: result.comment.id, entryId: "entry-1", status });
  }
});

test("honeypot-tripped", async () => {
  const policy = makePolicy();
  const result = await policy.submit(makeSubmission({ ingressContext: { authorIpHash: "hash-1", honeypotValue: "bot-filled-this" } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "honeypot-tripped");
});

test("a spam-scored submission is stored silently as spam, never rejected at the boundary", async () => {
  const policy = makePolicy();
  const result = await policy.submit(makeSubmission({ bodyRaw: "buy cheap viagra and cialis now, click here now" }));
  assert.equal(result.ok, true, "spam must never be a rejection — it's an oracle for spammers");
  if (result.ok) {
    assert.equal(result.autoClassified, "spam");
    assert.equal(result.comment.status, "spam");
  }
});

test("the stored bodyText is sanitized (HTML stripped)", async () => {
  const policy = makePolicy();
  const result = await policy.submit(makeSubmission({ bodyRaw: "<script>alert(1)</script>hello <b>world</b>" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.comment.bodyText, "alert(1)hello world");
});

// OQ-3 resolution (ADR-031 round-2 fold, SPEC-035): every ingress-created comment gets a `submit`
// moderation_log row attributed to the seeded system principal, with `toStatus` matching whatever
// the ingress auto-classified.

test("a pending submission gets a submit log entry attributed to the system principal, toStatus 'pending'", async () => {
  const repo = new InMemoryCommentRepo();
  const policy = makePolicy({ repo });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const log = await repo.listModerationLog({ workspaceId: WORKSPACE_ID, commentId: result.comment.id });
  assert.equal(log.length, 1);
  assert.ok(log[0]);
  assert.equal(log[0].action, "submit");
  assert.equal(log[0].fromStatus, null);
  assert.equal(log[0].toStatus, "pending");
  assert.equal(log[0].actorPrincipalId, COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID);
});

test("an auto-approved submission (requireModeration: false) gets a submit log entry, toStatus 'approved'", async () => {
  const repo = new InMemoryCommentRepo();
  const policy = makePolicy({ repo, settings: { requireModeration: false } });
  const result = await policy.submit(makeSubmission());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const log = await repo.listModerationLog({ workspaceId: WORKSPACE_ID, commentId: result.comment.id });
  assert.equal(log.length, 1);
  assert.ok(log[0]);
  assert.equal(log[0].toStatus, "approved");
  assert.equal(log[0].actorPrincipalId, COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID);
});

test("a spam-classified submission gets a submit log entry, toStatus 'spam'", async () => {
  const repo = new InMemoryCommentRepo();
  const policy = makePolicy({ repo });
  const result = await policy.submit(makeSubmission({ bodyRaw: "buy cheap viagra and cialis now, click here now" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.autoClassified, "spam");

  const log = await repo.listModerationLog({ workspaceId: WORKSPACE_ID, commentId: result.comment.id });
  assert.equal(log.length, 1);
  assert.ok(log[0]);
  assert.equal(log[0].toStatus, "spam");
  assert.equal(log[0].actorPrincipalId, COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID);
});

// SPEC-035 (ADR-028 Settings Layered Ledger wiring) — `getSettings` is a per-call resolver, not a
// boot-captured snapshot. Proves a settings change between two submissions is observed on the
// SECOND submission without reconstructing the policy — i.e. an operator's ledger write takes
// effect on the next request, not only after a restart.
test("getSettings is read fresh on every submit() call, not captured once at construction", async () => {
  const repo = new InMemoryCommentRepo();
  let requireModeration = true;
  const policy = createCommentIngressPolicy({
    repo,
    spamCheck: new HeuristicSpamCheck(),
    hooks: createCommentHookRegistry(),
    clock: { nowMs: () => Date.parse("2026-07-16T00:00:00.000Z") },
    idGen: { newId: () => `comment-${Math.random().toString(36).slice(2)}` },
    getSettings: async () => defaultSettings({ requireModeration }),
    entryLookup: async () => OPEN_ENTRY,
    rateLimiter: alwaysAllowRateLimiter(),
    outbox: new InMemoryOutbox(),
  });

  const first = await policy.submit(makeSubmission());
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.autoClassified, "pending");

  requireModeration = false; // mutate the underlying "ledger" between requests
  const second = await policy.submit(makeSubmission());
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.autoClassified, "approved", "the SAME policy instance must reflect the settings change");
});

test("a reply's threadRootId is the ROOT ancestor's id, not the immediate parent's", async () => {
  const repo = new InMemoryCommentRepo();
  await repo.create({ record: {
    id: "root",
    workspaceId: WORKSPACE_ID,
    entryId: "entry-1",
    parentId: null,
    threadRootId: "root",
    depth: 0,
    status: "approved",
    authorPrincipalId: null,
    authorName: "x",
    authorEmail: null,
    authorUrl: null,
    authorIpHash: null,
    bodyText: "x",
    spamScore: null,
    spamProvider: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 0,
  } }, {});
  await repo.create({ record: {
    id: "reply-1",
    workspaceId: WORKSPACE_ID,
    entryId: "entry-1",
    parentId: "root",
    threadRootId: "root",
    depth: 1,
    status: "approved",
    authorPrincipalId: null,
    authorName: "x",
    authorEmail: null,
    authorUrl: null,
    authorIpHash: null,
    bodyText: "x",
    spamScore: null,
    spamProvider: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 0,
  } }, {});

  const policy = makePolicy({ repo });
  const result = await policy.submit(makeSubmission({ parentId: "reply-1" }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.comment.threadRootId, "root");
    assert.equal(result.comment.depth, 2);
  }
});

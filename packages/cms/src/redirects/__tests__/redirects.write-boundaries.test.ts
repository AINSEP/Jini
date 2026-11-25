import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createVerifiedOrigin,
  InMemoryOriginSettingRepo,
  OriginRegistry,
} from "@jini-ai/core/contracts/server/verified-origin";
import { InMemoryOutbox } from "./support/events.fixture.js";
import { redirectMatcher } from "../matcher.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import {
  checkRedirectFieldsWouldWrite,
  createRedirect,
  importRedirects,
  siteRelativeTargetReason,
  updateRedirect,
  type RedirectsWriteDeps,
} from "../redirects.js";
import { contributeRedirectPublish, type RedirectRepoPublishConfig } from "../site/publish-content.js";
import { RedirectConflictError, RedirectLoopError, RedirectNotFoundError, RedirectValidationError } from "../types.js";
import type { RedirectRecord } from "../types.js";

/**
 * @file Boundary pins for the write chokepoint's less-travelled arms: the site-relative refusal
 * wording, `checkRedirectFieldsWouldWrite`'s message mapping, the 32-hop cycle walk bound, the
 * update path's pattern check and post-restore re-read, and the import error codes.
 */

const WORKSPACE_ID = "workspace-1";
const ACTOR_ID = "user-1";
const reservedSegments = new Set(["admin", "api"]);

function makeDeps(repo: InMemoryRedirectRepo = new InMemoryRedirectRepo()): RedirectsWriteDeps {
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [{
    workspaceId: WORKSPACE_ID,
    origin: createVerifiedOrigin({ scheme: "https", host: "trusted.example", verifiedAt: "2026-07-13T00:00:00.000Z", source: "workspace-setting" }),
    redirectAllowlist: [],
  }] });
  let idTick = 0;
  return {
    reservedSegments,
    repo,
    remove: async () => ({ ok: true, version: null }),
    isInTrash: async () => false,
    restore: async () => "restored",
    db: repo,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") },
    idGen: { newId: () => `redirect-${++idTick}` },
    outbox: new InMemoryOutbox(),
  };
}

function record(overrides: Partial<RedirectRecord>): RedirectRecord {
  return { id: "seed", workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/seed", toTarget: "/seed-target", statusCode: 301,
    status: "active", override: false, priority: 0, source: "manual", createdByPrincipal: ACTOR_ID,
    createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", version: 1, ...overrides };
}

const fields = { workspaceId: WORKSPACE_ID, matchType: "exact" as const, fromPattern: "/from", toTarget: "/to", statusCode: 301 as const, priority: 0 };

test("siteRelativeTargetReason names an unparseable target", () => {
  assert.equal(siteRelativeTargetReason({ target: "http://[", reservedSegments }, {}), "it is not a parseable URL path");
});

test("siteRelativeTargetReason names a malformed percent-encoding", () => {
  assert.equal(siteRelativeTargetReason({ target: "/a%zz", reservedSegments }, {}), "it contains a malformed percent-encoding");
});

test("siteRelativeTargetReason names an encoded control character", () => {
  assert.equal(siteRelativeTargetReason({ target: "/a%00", reservedSegments }, {}), "it contains, or decodes to, a backslash or a control character");
});

test("checkRedirectFieldsWouldWrite returns null for fields a create would accept", async () => {
  assert.equal(await checkRedirectFieldsWouldWrite({ deps: makeDeps(), fields }), null);
});

test("checkRedirectFieldsWouldWrite returns the pattern refusal message", async () => {
  assert.equal(await checkRedirectFieldsWouldWrite({ deps: makeDeps(), fields: { ...fields, matchType: "regex" } }),
    "matchType 'regex' is not enabled in v1");
});

test("checkRedirectFieldsWouldWrite re-gates a collapsed target", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ fromPattern: "/to", toTarget: "https://evil.example/x" }));
  assert.equal(await checkRedirectFieldsWouldWrite({ deps: makeDeps(repo), fields }),
    "toTarget 'https://evil.example/x' is not an allowed redirect destination");
});

test("checkRedirectFieldsWouldWrite reports a duplicate exact source", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ id: "existing", fromPattern: "/from" }));
  assert.equal(await checkRedirectFieldsWouldWrite({ deps: makeDeps(repo), fields }), "an active exact rule for '/from' already exists");
});

test("checkRedirectFieldsWouldWrite ignores the destination's own row when excludeId names it", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ id: "existing", fromPattern: "/from" }));
  assert.equal(await checkRedirectFieldsWouldWrite({ deps: makeDeps(repo), fields }, { excludeId: "existing" }), null);
});

class ThrowingLookupRepo extends InMemoryRedirectRepo {
  constructor(private readonly thrown: unknown) { super(); }
  override async lookupExact(): Promise<RedirectRecord | null> { throw this.thrown; }
}

test("checkRedirectFieldsWouldWrite stringifies a non-Error throw", async () => {
  assert.equal(await checkRedirectFieldsWouldWrite({ deps: makeDeps(new ThrowingLookupRepo("lookup offline")), fields }), "lookup offline");
});

test("a target whose existing chain is inactive past one hop is stored uncollapsed", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ fromPattern: "/to", toTarget: "/elsewhere", status: "disabled" }));
  const { record: created } = await createRedirect({ deps: makeDeps(repo), input: { ...fields, actorId: ACTOR_ID } });
  assert.equal(created.toTarget, "/to");
});

async function seedChain(repo: InMemoryRedirectRepo, length: number, last: string): Promise<void> {
  for (let i = 0; i < length; i++) {
    await repo.insertRedirect(record({ id: `h${i}`, fromPattern: `/h${i}`, toTarget: i === length - 1 ? last : `/h${i + 1}` }));
  }
}

test("a cycle reached on the last of the 32 walked hops is still rejected", async () => {
  const repo = new InMemoryRedirectRepo();
  // /from -> /h0 collapses to /h1; hops 0-30 walk /h1../h31, /h31 -> /from is seen on hop 31.
  await seedChain(repo, 32, "/from");
  await assert.rejects(() => createRedirect({ deps: makeDeps(repo), input: { ...fields, toTarget: "/h0", actorId: ACTOR_ID } }),
    (err: unknown) => err instanceof RedirectLoopError
      && err.message === "redirect from '/from' would create a cycle via '/h0' (following existing redirects leads back to '/from')");
});

test("a cycle beyond the 32-hop walk bound is not detected (REQ-26 bound)", async () => {
  const repo = new InMemoryRedirectRepo();
  await seedChain(repo, 33, "/from");
  const { record: created } = await createRedirect({ deps: makeDeps(repo), input: { ...fields, toTarget: "/h0", actorId: ACTOR_ID } });
  assert.equal(created.toTarget, "/h1");
});

test("the cycle walk stops at an absolute hop", async () => {
  const repo = new InMemoryRedirectRepo();
  await seedChain(repo, 3, "https://trusted.example/landing");
  const { record: created } = await createRedirect({ deps: makeDeps(repo), input: { ...fields, toTarget: "/h0", actorId: ACTOR_ID } });
  assert.equal(created.toTarget, "/h1");
});

test("updateRedirect refuses a merged pattern the matcher rejects", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ id: "existing", fromPattern: "/from", toTarget: "/to" }));
  await assert.rejects(() => updateRedirect({ deps: makeDeps(repo), input: { workspaceId: WORKSPACE_ID, id: "existing", matchType: "regex", actorId: ACTOR_ID } }),
    (err: unknown) => err instanceof RedirectValidationError && err.message === "matchType 'regex' is not enabled in v1");
});

class VanishAfterRestoreRepo extends InMemoryRedirectRepo {
  private reads = 0;
  override async findById(required: { workspaceId: string; id: string }): Promise<RedirectRecord | null> {
    this.reads += 1;
    return this.reads === 1 ? super.findById(required) : null;
  }
}

test("updateRedirect reports not-found when a restored row is gone on re-read", async () => {
  const repo = new VanishAfterRestoreRepo();
  await repo.insertRedirect(record({ id: "trashed", fromPattern: "/trashed" }));
  const deps = { ...makeDeps(repo), isInTrash: async () => true };
  await assert.rejects(() => updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: "trashed", status: "active", actorId: ACTOR_ID } }),
    (err: unknown) => err instanceof RedirectNotFoundError && err.message === "redirect 'trashed' was not found");
});

test("importRedirects reports a refused target as REDIRECT_TARGET_NOT_ALLOWED", async () => {
  const { failed } = await importRedirects({ deps: makeDeps(), input: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, rules: [
    { ...fields, toTarget: "https://evil.example/x", actorId: ACTOR_ID },
  ] } });
  assert.deepEqual(failed, [{ index: 0, code: "REDIRECT_TARGET_NOT_ALLOWED", message: "toTarget 'https://evil.example/x' is not an allowed redirect destination" }]);
});

test("importRedirects reports a self-loop as REDIRECT_LOOP_DETECTED", async () => {
  const { failed } = await importRedirects({ deps: makeDeps(), input: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, rules: [
    { ...fields, toTarget: "/from", actorId: ACTOR_ID },
  ] } });
  assert.deepEqual(failed, [{ index: 0, code: "REDIRECT_LOOP_DETECTED", message: "redirect from '/from' would create a cycle via '/from' (resolves back to '/from')" }]);
});

test("importRedirects redacts an infrastructure failure as INTERNAL_ERROR", async () => {
  const { failed } = await importRedirects({ deps: makeDeps(new ThrowingLookupRepo(new Error("/private/driver/path"))), input: {
    workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, rules: [{ ...fields, actorId: ACTOR_ID }],
  } });
  assert.deepEqual(failed, [{ index: 0, code: "INTERNAL_ERROR", message: "an internal error occurred" }]);
});

test("restoring a trashed rule returns the re-read row and enqueues one redirect.updated", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ id: "trashed", fromPattern: "/trashed" }));
  const deps = { ...makeDeps(repo), isInTrash: async () => true };
  const { record: restored } = await updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: "trashed", status: "active", actorId: ACTOR_ID } });
  assert.equal(restored.id, "trashed");
  const pending = await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" });
  assert.deepEqual(pending.map((row) => row.event.name), ["redirect.updated"]);
});

const CHANGED_DURING_PUBLISH = "This redirect changed while it was being published. Review it and try again.";

async function pendingEvents(deps: RedirectsWriteDeps): Promise<string[]> {
  const pending = await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" });
  return pending.map((row) => `${row.event.name}:${String((row.event.payload as { redirectId?: string }).redirectId)}`);
}

test("a destination redirect changed after review is not overwritten by publish", async () => {
  const repo = new InMemoryRedirectRepo();
  await repo.insertRedirect(record({ id: "dest", fromPattern: "/moved", toTarget: "/reviewed", version: 1 }));
  const deps = makeDeps(repo);
  const config: RedirectRepoPublishConfig = contributeRedirectPublish({ createRepoPublishHandler: (cfg) => cfg, redirectsTable: "site_redirects" });
  // The publish handler read (and version-checked) this row; an operator then edits it before the write lands.
  const reviewed = await config.find({ ports: deps, workspaceId: WORKSPACE_ID, id: "exact:/moved" });
  assert.equal(reviewed?.version, 1);
  await updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: "dest", toTarget: "/operator-edit", actorId: ACTOR_ID } });
  await deps.outbox.claimPending({ batchSize: 10, nowIso: "2099-01-01T00:00:00.000Z" });

  const state = { matchType: "exact", fromPattern: "/moved", toTarget: "/published", statusCode: 301, override: false, priority: 0, status: "active" };
  await assert.rejects(
    () => config.write({ ports: deps, workspaceId: WORKSPACE_ID, id: "exact:/moved", state, existing: reviewed, principalId: "publisher" }),
    (err: unknown) => err instanceof RedirectConflictError && err.message === CHANGED_DURING_PUBLISH,
  );
  const stored = await repo.findById({ workspaceId: WORKSPACE_ID, id: "dest" });
  assert.equal(stored?.toTarget, "/operator-edit");
  assert.equal(stored?.version, 2);
  assert.deepEqual(repo.listRevisionsForTests({ redirectId: "dest" }).map((rev) => [rev.seq, rev.actorId]), [[2, ACTOR_ID]]);
  assert.deepEqual(await pendingEvents(deps), []);
});

/** A one-holder writer lock, like the adapter's `redirects:write` lock; `queued` resolves the first
 *  time a caller has to wait for it, so the test can observe contention without a timer. */
function writerLock() {
  let tail: Promise<void> = Promise.resolve();
  let held = false;
  let signalQueued!: () => void;
  const queued = new Promise<void>((resolve) => { signalQueued = resolve; });
  const transaction = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (held) signalQueued();
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    held = true;
    try { return await fn(); } finally { held = false; release(); }
  };
  return { transaction, queued };
}

/** Holds the first `findById` caller just after its read returns, until `release` settles. */
class PausingFirstReadRepo extends InMemoryRedirectRepo {
  private reads = 0;
  constructor(private readonly gate: { paused: () => void; release: Promise<void> }) { super(); }
  override async findById(required: { workspaceId: string; id: string }): Promise<RedirectRecord | null> {
    const row = await super.findById(required);
    this.reads += 1;
    if (this.reads === 1) { this.gate.paused(); await this.gate.release; }
    return row;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test("an intervening redirect edit cannot pass the version-gated write", async () => {
  const firstPaused = deferred();
  const releaseFirst = deferred();
  // The first writer pauses right after it reads the row its version comparison is made against.
  const repo = new PausingFirstReadRepo({ paused: firstPaused.resolve, release: releaseFirst.promise });
  await repo.insertRedirect(record({ id: "dest", fromPattern: "/moved", toTarget: "/reviewed", version: 1 }));
  const lock = writerLock();
  const deps: RedirectsWriteDeps = { ...makeDeps(repo), transaction: lock.transaction };
  const write = (toTarget: string, actorId: string) =>
    updateRedirect({ deps, input: { workspaceId: WORKSPACE_ID, id: "dest", toTarget, expectedVersion: 1, actorId } });

  const first = write("/first", "first-writer");
  await firstPaused.promise;
  const second = write("/second", "second-writer");
  const secondSettled = second.then(() => undefined, () => undefined);
  // Either the second writer is held behind the first one's lock, or it ran straight through.
  await Promise.race([lock.queued, secondSettled]);
  releaseFirst.resolve();
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);

  assert.equal(firstResult.status, "fulfilled");
  assert.equal(secondResult.status, "rejected");
  assert.ok(secondResult.status === "rejected" && secondResult.reason instanceof RedirectConflictError);
  assert.equal(secondResult.reason.message, CHANGED_DURING_PUBLISH);
  const stored = await repo.findById({ workspaceId: WORKSPACE_ID, id: "dest" });
  assert.equal(stored?.toTarget, "/first");
  assert.equal(stored?.version, 2);
  // The losing writer leaves no revision and no success event behind.
  assert.deepEqual(repo.listRevisionsForTests({ redirectId: "dest" }).map((rev) => [rev.seq, rev.actorId]), [[2, "first-writer"]]);
  assert.deepEqual(await pendingEvents(deps), ["redirect.updated:dest"]);
});

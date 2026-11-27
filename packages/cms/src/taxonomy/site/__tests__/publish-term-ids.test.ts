/**
 * @file A term sync checks the permission and every added term BEFORE the caller writes its row, so a
 * refusal is a `blocked` row that wrote nothing. The ports are a recording proxy: any port method the
 * code under test reaches is logged, so "no write" means no call at all, not just no successful one.
 */
import type { AuthorizeFn, OutboxPort } from "@jini-ai/core/contracts/events";
import { describe, expect, it } from "vitest";

import { PublishContentApplyRowError } from "../../../publish/transfer/apply-errors.js";
import { prepareTermSync, readTermIds, TERM_SYNC_PERMISSION, withTermIds, type TermSyncDeps, type TermSyncPorts } from "../publish-term-ids.js";

import { InMemoryContentLookup, InMemoryEntryTermRepo, InMemoryTaxonomyRepo, InMemoryTaxonomyRevisionRepo, InMemoryTermRepo } from "../../repo.memory.js";

type Calls = string[];

/** One port whose listed methods answer as given and whose every other method is recorded as a call. */
function recordingPort(name: string, calls: Calls, answers: Record<string, (...args: unknown[]) => unknown>): unknown {
  return new Proxy(answers, {
    get(target, key) {
      if (typeof key !== "string" || key === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push(`${name}.${key}`);
        const answer = target[key];
        return Promise.resolve(answer ? answer(...args) : undefined);
      };
    },
  });
}

function fixture({ current = [] as string[], terms = {} as Record<string, { status: string } | undefined> } = {}) {
  const calls: Calls = [];
  const ports = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== "string" || key === "then") return undefined;
      if (key === "entryTerms") return recordingPort(key, calls, { listForContent: () => current.map((termId) => ({ termId })) });
      if (key === "terms") return recordingPort(key, calls, { findAnyById: (input) => terms[(input as { id: string }).id] });
      return recordingPort(key, calls, {});
    },
  }) as TermSyncPorts;
  return { calls, ports };
}

const deps = ({ authorize, withOutbox = true }: { authorize?: AuthorizeFn; withOutbox?: boolean } = {}): TermSyncDeps => ({
  workspaceId: "ws-terms", clock: { nowMs: () => 0 }, idGen: { newId: () => "id-1" },
  ...(withOutbox ? { outbox: { enqueue: async () => { throw new Error("outbox must not be written"); } } as unknown as OutboxPort } : {}),
  ...(authorize ? { authorize } : {}),
});
const request = { entityType: "post", entityId: "post-1", principalId: "user-1", contentType: "post" };

describe("prepareTermSync", () => {
  it("a denied sync is a blocked row before any term read or write, and never returns apply", async () => {
    const { calls, ports } = fixture({ current: ["t-old"], terms: { "t-new": { status: "active" } } });
    const asked: unknown[] = [];
    const authorize = async (params: unknown) => { asked.push(params); return { allowed: false, reason: "role viewer" }; };
    const outcome = await prepareTermSync({ ports, deps: deps({ authorize }), ...request, wanted: ["t-new"] }).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(PublishContentApplyRowError);
    expect((outcome as PublishContentApplyRowError).rowOutcome).toBe("blocked");
    expect((outcome as Error).message).toBe(`post 'post-1' has category or tag changes, and you need '${TERM_SYNC_PERMISSION}' to publish them (role viewer)`);
    expect(asked).toEqual([{ principalId: "user-1", permission: TERM_SYNC_PERMISSION, workspaceId: "ws-terms" }]);
    expect(calls, "only the current set was read").toEqual(["entryTerms.listForContent"]);
  });

  it("an allowed sync with a trashed added term is blocked after the term read and before any write", async () => {
    const { calls, ports } = fixture({ terms: { "t-new": { status: "trash" } } });
    const authorize = async () => ({ allowed: true, reason: "" });
    await expect(prepareTermSync({ ports, deps: deps({ authorize }), ...request, wanted: ["t-new"] }))
      .rejects.toThrow("post 'post-1' is tagged with term 't-new', which is in the trash at this destination — publish or restore that term first");
    expect(calls).toEqual(["entryTerms.listForContent", "terms.findAnyById"]);
  });

  it("a change without authorize or outbox fails plainly before any term read", async () => {
    const { calls, ports } = fixture({ current: ["t-old"] });
    await expect(prepareTermSync({ ports, deps: deps({ withOutbox: false, authorize: async () => ({ allowed: true, reason: "" }) }), ...request, wanted: [] }))
      .rejects.toThrow("publish-content: post.apply() requires PublishContentDeps.authorize/outbox to sync term assignments.");
    expect(calls).toEqual(["entryTerms.listForContent"]);
  });

  it("an unchanged set needs no permission and its apply/revert write nothing", async () => {
    const { calls, ports } = fixture({ current: ["t-a", "t-b"] });
    const sync = await prepareTermSync({ ports, deps: deps(), ...request, wanted: ["t-b", "t-a"] });
    await sync.apply();
    await sync.revert();
    expect(calls).toEqual(["entryTerms.listForContent"]);
  });

  it("without taxonomy ports, no terms is a no-op and wanted terms fail plainly", async () => {
    const sync = await prepareTermSync({ ports: undefined, deps: deps(), ...request, wanted: "not-a-list" });
    await expect(sync.apply()).resolves.toBeUndefined();
    await expect(prepareTermSync({ ports: undefined, deps: deps(), ...request, wanted: ["t-a"] }))
      .rejects.toThrow("publish-content: post 'post-1' carries term assignments, but this deps bag wires no taxonomy ports — wire ports.term.");
  });
});

it("packs sorted term identities without changing the caller's state or adding an empty field", async () => {
  const { ports } = fixture({ current: ["t-z", "t-m", "t-a"] });
  const termIds = await readTermIds({ ports, contentType: "post", contentId: "post-1" });
  const state = { title: "Story" };
  expect(withTermIds({ state, termIds })).toEqual({ title: "Story", termIds: ["t-a", "t-m", "t-z"] });
  expect(state).toEqual({ title: "Story" });
  expect(withTermIds({ state, termIds: await readTermIds({ ports: fixture().ports, contentType: "post", contentId: "post-1" }) })).toBe(state);
});

it("apply and revert swap the exact assignment sets and emit one scoped event per write", async () => {
  const terms = new InMemoryTermRepo();
  for (const id of ["old", "keep", "new"]) {
    await terms.insert({ id, taxonomyId: "topics", parentId: null, status: "active", name: id, updatedAt: "1970-01-01T00:00:00.000Z", version: 1 });
  }
  const base = new InMemoryEntryTermRepo();
  const entryTerms = Object.assign(base, {
    listForContent: async ({ contentType, contentId }: { contentType: string; contentId: string }) => {
      if (contentType !== "post" || contentId !== "post-1") throw new Error("Wrong assignment target");
      const rows = [];
      for (const termId of ["old", "keep", "new"]) {
        if (await base.countByTerm({ termId })) rows.push({ termId, termName: termId, taxonomyName: "Topics" });
      }
      return rows;
    },
  });
  const scope = { contentType: "post", contentId: "post-1" };
  for (const termId of ["old", "keep"]) await entryTerms.upsert({ ...scope, termId, addedAt: "1970-01-01T00:00:00.000Z" });
  const ports: TermSyncPorts = {
    terms: Object.assign(terms, { findAnyById: terms.findByIdFull.bind(terms) }), entryTerms,
    taxonomies: new InMemoryTaxonomyRepo(), revisions: new InMemoryTaxonomyRevisionRepo(), stampWatermark: () => {},
    contentLookup: new InMemoryContentLookup({}, { seed: [{ ...scope, workspaceId: "ws-terms", kind: "post" }] }),
    contentTypeTaxonomyPolicy: { taxonomiesFor: async () => null },
  };
  const events: { workspaceId: string; name: string }[] = [];
  const outbox: OutboxPort = { enqueue: async ({ workspaceId, name }) => { events.push({ workspaceId, name }); },
    claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} };
  const sync = await prepareTermSync({ ports, ...request, wanted: ["keep", "new"],
    deps: { ...deps({ authorize: async () => ({ allowed: true, reason: "grant" }) }), outbox } });
  const read = () => readTermIds({ ports, ...scope });
  expect(await read()).toEqual(["keep", "old"]);
  await sync.apply();
  expect(await read()).toEqual(["keep", "new"]);
  await sync.revert();
  expect(await read()).toEqual(["keep", "old"]);
  expect(events).toEqual(["taxonomy.terms_assigned", "taxonomy.terms_unassigned", "taxonomy.terms_assigned", "taxonomy.terms_unassigned"]
    .map(name => ({ workspaceId: "ws-terms", name })));
});

it("a missing added term blocks the destination write with its term identity", async () => {
  const { ports, calls } = fixture();
  const promise = prepareTermSync({ ports, deps: deps({ authorize: async () => ({ allowed: true, reason: "grant" }) }), ...request, wanted: ["unpublished"] });
  const failure = await promise.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PublishContentApplyRowError);
  expect(failure).toMatchObject({ rowOutcome: "blocked", message: "post 'post-1' is tagged with term 'unpublished', which is missing at this destination — publish or restore that term first" });
  expect(calls).toEqual(["entryTerms.listForContent", "terms.findAnyById"]);
});

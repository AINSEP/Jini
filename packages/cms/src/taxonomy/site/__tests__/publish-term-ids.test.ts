/**
 * @file A term sync checks the permission and every added term BEFORE the caller writes its row, so a
 * refusal is a `blocked` row that wrote nothing. The ports are a recording proxy: any port method the
 * code under test reaches is logged, so "no write" means no call at all, not just no successful one.
 */
import type { AuthorizeFn, OutboxPort } from "@jini-ai/core/contracts/events";
import { describe, expect, it } from "vitest";

import { PublishContentApplyRowError } from "../../../publish/transfer/apply-errors.js";
import { prepareTermSync, TERM_SYNC_PERMISSION, type TermSyncDeps, type TermSyncPorts } from "../publish-term-ids.js";

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

import { describe, expect, it } from "vitest";

import type { BackstopAuditPort, BackstopAuditRecord } from "../../../../publish/transfer/index.js";
import {
  backstopGapsRoute, backstopRunRoute, backstopSendRoute, backstopStatusRoute, backstopUndoRoute,
  type BackstopActorDeps, type BackstopSendRouteDeps, type BackstopUndoRouteDeps,
} from "../backstop.js";
import { raw, refusalOf, WORKSPACE_ID } from "./transport-helpers.js";

const BASE = "/api/admin/v1/workspaces/:workspaceId/publish-content";
const OWNER = { id: "owner" };
const FORBIDDEN = "Only the owner can send by hand.";

function log(overrides: Partial<BackstopAuditRecord> = {}): BackstopAuditRecord {
  return {
    id: "log-1", workspaceId: WORKSPACE_ID, direction: "destination", actorId: "owner", destination: "https://live.example",
    reason: "Emergency repair", at: "2026-10-31T00:00:00.000Z", gapLabels: [], items: [{ entityType: "raw-row", id: "a", afterHash: "h" }],
    result: "success", runId: "run-1", details: {}, inverses: [], ...overrides,
  } as BackstopAuditRecord;
}

function audit(record: BackstopAuditRecord | null = log()): BackstopAuditPort {
  return { ready: async () => true, save: async () => {}, get: async () => record, gaps: async () => [{ label: "gap" }] as never };
}

function actorDeps(allowed = true): BackstopActorDeps & { readyAudit(): Promise<BackstopAuditPort | null> } {
  return { workspaceId: WORKSPACE_ID, forbiddenMessage: FORBIDDEN, mayUseBackstop: async () => allowed, readyAudit: async () => audit() };
}

function sendDeps(overrides: Partial<BackstopSendRouteDeps> = {}): BackstopSendRouteDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls, ...actorDeps(),
    backstopRefusal: () => undefined,
    findPeer: async () => ({ baseUrl: "https://live.example" }),
    checkRequest: ({ body, destinationHost }) => {
      calls.push({ checked: body, destinationHost });
      return { request: { reason: "Emergency repair", typedHost: destinationHost, selection: { rows: [], files: [] } as never } };
    },
    redeemPlan: async (input) => { calls.push({ redeem: input.log.id }); return { runId: "run-1" }; },
    planSelection: async (input) => { calls.push({ plan: input.overwriteEntityKeys }); return { value: { entities: [], logId: "log-2" } }; },
    ...overrides,
  };
}

const sendBody = (body: Record<string, unknown>) => backstopSendRoute.parse(raw({ workspaceId: WORKSPACE_ID }, body));
async function send(deps: BackstopSendRouteDeps, body: Record<string, unknown>) {
  const parsed = sendBody(body);
  if (!parsed.ok) throw new Error("parse refused");
  return backstopSendRoute.handle({ input: parsed.value, deps, context: OWNER } as never, {} as never);
}

describe("publish-content backstop route specs", () => {
  it("pins method and path of every route, in mount order", () => {
    expect([backstopStatusRoute, backstopRunRoute, backstopSendRoute, backstopGapsRoute, backstopUndoRoute].map((spec) => `${spec.method} ${spec.path}`)).toEqual([
      `get ${BASE}/backstop/status`, `get ${BASE}/runs/:runId/backstop`, `post ${BASE}/backstop`,
      `get ${BASE}/backstop/gaps`, `post ${BASE}/runs/:runId/undo-backstop`,
    ]);
  });

  it("status answers the audit install state for an allowed actor and the flat 403 otherwise", async () => {
    const answer = await backstopStatusRoute.handle({ input: undefined, deps: { ...actorDeps(), readyAudit: async () => null }, context: OWNER } as never, {} as never);
    expect(answer).toEqual({ ok: true, value: { allowed: true, installed: false } });
    expect(await refusalOf(() => backstopStatusRoute.handle({ input: undefined, deps: actorDeps(false), context: OWNER } as never, {} as never)))
      .toEqual({ status: 403, body: { error: FORBIDDEN, code: "FORBIDDEN" } });
  });

  it("run detail: 503 without audit storage, 404 for a source log, the summary for a destination log", async () => {
    const input = { runId: "run-1" };
    expect(backstopRunRoute.parse(raw({ workspaceId: WORKSPACE_ID, runId: "run-1" }))).toEqual({ ok: true, value: input });
    expect(await refusalOf(() => backstopRunRoute.handle({ input, deps: { ...actorDeps(), readyAudit: async () => null }, context: OWNER } as never, {} as never)))
      .toEqual({ status: 503, body: { error: "Send by hand needs its audit storage installed.", code: "BACKSTOP_NOT_INSTALLED" } });
    expect(await refusalOf(() => backstopRunRoute.handle({ input, deps: { ...actorDeps(), readyAudit: async () => audit(log({ direction: "source" })) }, context: OWNER } as never, {} as never)))
      .toEqual({ status: 404, body: { error: "This send was not found on this site." } });
    const answer = await backstopRunRoute.handle({ input, deps: actorDeps(), context: OWNER } as never, {} as never);
    expect(answer).toEqual({ ok: true, value: { runId: "run-1", reason: "Emergency repair", items: [{ entityType: "raw-row", id: "a" }], canUndo: true } });
  });

  it("gaps asks the authorizer for publish_content.read with no entity type, then lists the gaps (or none)", async () => {
    const calls: unknown[] = [];
    const authorize = async (args: unknown) => { calls.push(args); };
    const answer = await backstopGapsRoute.handle({ input: undefined, deps: actorDeps(), context: OWNER, authorize } as never, {} as never);
    expect(calls).toEqual([{ permission: "publish_content.read" }]);
    expect(answer).toEqual({ ok: true, value: { gaps: [{ label: "gap" }] } });
    const none = await backstopGapsRoute.handle({ input: undefined, deps: { ...actorDeps(), readyAudit: async () => null }, context: OWNER, authorize } as never, {} as never);
    expect(none).toEqual({ ok: true, value: { gaps: [] } });
  });

  it("send: the actor gate runs before the body is read", async () => {
    const deps = sendDeps({ mayUseBackstop: async () => false });
    expect(await refusalOf(() => send(deps, { peerId: 7 }))).toEqual({ status: 403, body: { error: FORBIDDEN, code: "FORBIDDEN" } });
  });

  it("send: refuses a missing peer id, an unknown peer and an unchecked request", async () => {
    expect(await refusalOf(() => send(sendDeps(), { action: "plan" }))).toEqual({ status: 400, body: { error: "Choose a connected live site.", code: "VALIDATION_ERROR" } });
    expect(await refusalOf(() => send(sendDeps({ findPeer: async () => null }), { peerId: "p" }))).toEqual({ status: 404, body: { error: "The connected live site was not found." } });
    expect(await refusalOf(() => send(sendDeps({ checkRequest: () => ({ error: "Type the live address." }) }), { peerId: "p" })))
      .toEqual({ status: 400, body: { error: "Type the live address.", code: "VALIDATION_ERROR" } });
  });

  it("send: a plan without a typed host is checked against the live host; send keeps the body as sent", async () => {
    const deps = sendDeps();
    await send(deps, { action: "plan", peerId: "p" });
    await send(deps, { action: "send", peerId: "p", logId: "missing" }).catch(() => undefined);
    expect(deps.calls[0]).toEqual({ checked: { action: "plan", peerId: "p", typedHost: "live.example" }, destinationHost: "live.example" });
    expect(deps.calls[2]).toEqual({ checked: { action: "send", peerId: "p", logId: "missing" }, destinationHost: "live.example" });
  });

  it("send: 503 without audit storage, 400 for an unknown action", async () => {
    expect(await refusalOf(() => send(sendDeps({ readyAudit: async () => null }), { peerId: "p", action: "plan" })))
      .toEqual({ status: 503, body: { error: "Send by hand needs its audit storage installed before it can send anything.", code: "BACKSTOP_NOT_INSTALLED" } });
    expect(await refusalOf(() => send(sendDeps(), { peerId: "p", action: "other" }))).toEqual({ status: 400, body: { error: "Choose Check what would change or Send to live." } });
  });

  it("send redeems only this actor's own planned source log for the same destination, reason and peer", async () => {
    const planned = log({ direction: "source", result: "planned", details: { peerId: "p" } });
    const deps = sendDeps({ readyAudit: async () => audit(planned) });
    const answer = await send(deps, { action: "send", peerId: "p", logId: "log-1" });
    expect(answer).toEqual({ ok: true, value: { runId: "run-1", logId: "log-1", destination: "https://live.example" } });
    for (const stale of [log({ direction: "source", result: "planned", details: { peerId: "other" } }), log({ direction: "source", result: "planned", actorId: "x", details: { peerId: "p" } }), log({ result: "planned", details: { peerId: "p" } })]) {
      expect(await refusalOf(() => send(sendDeps({ readyAudit: async () => audit(stale) }), { action: "send", peerId: "p", logId: "log-1" })))
        .toEqual({ status: 409, body: { error: "Check what would change again before sending." } });
    }
    expect(await refusalOf(() => send(deps, { action: "send", peerId: "p", logId: 3 }))).toEqual({ status: 409, body: { error: "Check what would change again before sending." } });
  });

  it("plan answers the host plan, or the 400 when an overwrite names an unselected item", async () => {
    expect(await send(sendDeps(), { action: "plan", peerId: "p", overwriteEntityKeys: ["raw-row:a"] })).toEqual({ ok: true, value: { entities: [], logId: "log-2" } });
    expect(await refusalOf(() => send(sendDeps({ planSelection: async () => ({ overwriteNotSelected: true }) }), { action: "plan", peerId: "p" })))
      .toEqual({ status: 400, body: { error: "Only selected items can be overwritten.", code: "VALIDATION_ERROR" } });
  });

  it("send maps a host-typed failure to its refusal and rethrows anything unmapped", async () => {
    const boom = new Error("boom");
    const mapped = sendDeps({ findPeer: async () => { throw boom; }, backstopRefusal: ({ error }) => (error === boom ? { status: 409, body: { error: "live refused" } } : undefined) });
    expect(await refusalOf(() => send(mapped, { peerId: "p" }))).toEqual({ status: 409, body: { error: "live refused" } });
    await expect(send(sendDeps({ findPeer: async () => { throw boom; } }), { peerId: "p" })).rejects.toBe(boom);
  });

  function undoDeps(record: BackstopAuditRecord | null, overrides: Partial<BackstopUndoRouteDeps> = {}): BackstopUndoRouteDeps {
    return {
      ...actorDeps(), backstopRefusal: () => undefined,
      openUndo: async () => ({ audit: audit(record), undoAll: async () => ["kept a.txt"] }), ...overrides,
    };
  }
  const undo = (deps: BackstopUndoRouteDeps) => backstopUndoRoute.handle({ input: { runId: "run-1" }, deps, context: OWNER } as never, {} as never);

  it("undo: 503 without storage, 404 without an undoable destination log, else the undone count", async () => {
    expect(await refusalOf(() => undo(undoDeps(log(), { openUndo: async () => null })))).toEqual({ status: 503, body: { error: "Send by hand needs its audit storage installed." } });
    for (const record of [null, log({ direction: "source" }), log({ result: "failure" })]) {
      expect(await refusalOf(() => undo(undoDeps(record)))).toEqual({ status: 404, body: { error: "This send has no undo available." } });
    }
    const inverses = [{ kind: "raw-row" }, { kind: "raw-file" }] as never;
    expect(await undo(undoDeps(log({ result: "failure", inverses })))).toEqual({ ok: true, value: { runId: "run-1", undone: 1, skipped: ["kept a.txt"] } });
    expect(await refusalOf(() => undo(undoDeps(log(), { mayUseBackstop: async () => false })))).toEqual({ status: 403, body: { error: FORBIDDEN, code: "FORBIDDEN" } });
  });
});

it("the backstop status route does not accept a caller-supplied audit target", () => {
  expect(backstopStatusRoute.parse({ params: { workspaceId: WORKSPACE_ID }, body: { workspaceId: "other" }, query: { runId: "foreign" } }))
    .toStrictEqual({ ok: true, value: undefined });
});

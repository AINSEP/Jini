import { expect, it, vi } from "vitest";
import type { HumanConfirmSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { ToolExecutionContext, SurfaceEmitter } from "@jini-ai/core";
import { ToolInputError } from "@jini-ai/core";
import { createSurfaceExchangeStore } from "../../surface-exchanges.js";
import { approvalToolHandler, requireHumanConfirm } from "../human-confirm.js";
import type { UIResource } from "@jini-ai/core/contracts/site/protocol-mcp-ui";

const CARD = { type: "resource", resource: { uri: "ui://confirm", mimeType: "text/html", text: "" } } as const satisfies UIResource;

const spec: HumanConfirmSpec = { toolId: "delete", errorCode: "DELETE", title: "Delete", details: [], confirmLabel: "Confirm",
  access: { resources: [{ id: "r", label: "r", scope: { personId: "person" }, previous: null, proposed: null, revision: null }] },
  alternatives: [{ id: "once", label: "Once", choice: "once" }] };

it("does not resume after the grant or approving person changes while the card is open", async () => {
  for (const revoked of ["grant", "person"]) {
    let displayed = false;
    const store = createSurfaceExchangeStore({ scheduler: { schedule: () => () => {} }, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "exchange" }, defaultChannel: "mcp-ui" });
    const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "person" }, run: { id: "run" }, input: {}, signal: new AbortController().signal };
    const grant = vi.fn(async () => { if (displayed && revoked === "grant") throw new Error("revoked grant"); });
    const approver = vi.fn(async () => { if (displayed && revoked === "person") throw new Error("changed person"); });
    const surfaces: HumanConfirmSurfaceDeps = { surfaceExchanges: store, assertAccessApprover: approver };
    const writer = vi.fn();
    const promise = requireHumanConfirm({ ctx, surfaces, spec, requireDeleteGrant: grant, render: () => CARD }, {
      emitSurface: async () => { displayed = true; store.deliver({ exchangeId: "exchange", principalId: "person", params: { decision: "confirm" } }, { toolId: "delete" }); },
    }).then(writer);
    await expect(promise).rejects.toThrow(revoked === "grant" ? "revoked grant" : "changed person");
    expect(writer).not.toHaveBeenCalled();
    expect(approver).toHaveBeenCalledTimes(2);
    expect(grant).toHaveBeenCalledTimes(revoked === "grant" ? 2 : 1);
  }
});

it("opens no exchange when already aborted and balances the abort listener", async () => {
  for (const preAborted of [true, false]) {
    const controller = new AbortController();
    if (preAborted) controller.abort();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const store = createSurfaceExchangeStore({ scheduler: { schedule: () => () => {} }, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "exchange" }, defaultChannel: "mcp-ui" });
    const open = vi.spyOn(store, "open");
    const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "person" }, run: { id: "run" }, input: {}, signal: controller.signal };
    const closes: (() => number)[] = [];
    const outcome = await requireHumanConfirm({ ctx, surfaces: { surfaceExchanges: store }, spec: { toolId: spec.toolId, errorCode: spec.errorCode, title: spec.title, details: [], confirmLabel: spec.confirmLabel }, requireDeleteGrant: async () => {}, render: ({ exchange }) => { const close = vi.spyOn(exchange, "close"); closes.push(() => close.mock.calls.length); return CARD; } }, { emitSurface: async () => { controller.abort(); controller.abort(); } });
    expect(outcome).toEqual({ confirmed: false, reason: "abandoned" });
    expect(open).toHaveBeenCalledTimes(preAborted ? 0 : 1);
    expect(add).toHaveBeenCalledTimes(preAborted ? 0 : 1);
    expect(remove).toHaveBeenCalledTimes(preAborted ? 0 : 1);
    if (!preAborted) {
      expect(remove.mock.calls[0]?.slice(0, 2)).toEqual(add.mock.calls[0]?.slice(0, 2));
      expect(add.mock.calls[0]?.[2]).toEqual({ once: true });
    }
    expect(closes[0]?.()).toBe(preAborted ? undefined : 2);
    expect(store.size()).toBe(0);
  }
});

it("does not select an unoffered choice and observes non-restorable receipts", async () => {
  const store = createSurfaceExchangeStore({ scheduler: { schedule: () => () => {} }, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "exchange" }, defaultChannel: "mcp-ui" });
  const open = vi.spyOn(store, "open");
  const controller = new AbortController();
  const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "person" }, run: { id: "run" }, input: {}, signal: controller.signal };
  const receipt = vi.fn();
  const retry = vi.fn(async () => {});
  const emit: SurfaceEmitter = Object.assign(async () => { store.deliver({ exchangeId: "exchange", principalId: "person", params: { decision: "confirm", choice: "unoffered" } }, { toolId: "delete" }); },
    { exchangeLifetime: { signal: controller.signal, runId: "run", toolId: "delete", principalId: "person", retry } });
  const outcome = await requireHumanConfirm({ ctx, surfaces: { surfaceExchanges: store, assertAccessApprover: async () => {}, approvalReceiptsFor: () => ({ onApprovalReceipt: receipt, restorable: false }) }, spec, requireDeleteGrant: async () => {}, render: () => CARD }, { emitSurface: emit });
  expect(outcome).toEqual({ confirmed: true });
  expect(receipt).toHaveBeenCalled();
  const wrapped = open.mock.calls[0]?.[0].emit;
  expect(wrapped?.exchangeLifetime).toMatchObject({ signal: controller.signal, runId: "run", toolId: "delete", principalId: "person" });
  if (!wrapped?.exchangeLifetime) throw new Error("missing exchange lifetime");
  await wrapped.exchangeLifetime.retry({ emit, signal: controller.signal });
  expect(retry).not.toHaveBeenCalled();
});

function approvalFixture(input: unknown = {}) {
  const surfaceExchanges = createSurfaceExchangeStore({
    scheduler: { schedule: () => () => {} }, clock: { nowMs: () => 0 },
    idGenerator: { newId: () => "exchange" }, defaultChannel: "mcp-ui",
  });
  const surfaces = { surfaceExchanges, assertAccessApprover: async () => {} };
  const ctx: ToolExecutionContext = {
    executionId: "ex", principal: { id: "person" }, run: { id: "r" },
    signal: new AbortController().signal, input,
  };
  const { access: _access, ...ordinary } = spec;
  return { surfaces, ctx, ordinary };
}

it("refuses a headless confirmation without rendering a card", async () => {
  const { ctx, surfaces, ordinary } = approvalFixture();
  const render = vi.fn(() => CARD);
  const result = requireHumanConfirm({ ctx, surfaces, spec: ordinary, requireDeleteGrant: async () => {}, render });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow("DELETE_NO_CONFIRMATION_CHANNEL: delete: this execution context has no interactive confirmation channel (no emitSurface), so a human cannot approve this action here. Nothing was changed.");
  expect(render.mock.calls).toEqual([]);
  expect(surfaces.surfaceExchanges.size()).toBe(0);
});

it("uses an explicit offered alternative from the real exchange and reports its receipt", async () => {
  const { ctx, surfaces } = approvalFixture();
  let openId = "";
  const receipt = vi.fn();
  const assertAccessApprover = vi.fn(async () => {});
  const emitSurface: SurfaceEmitter = Object.assign(async () => {
    expect(surfaces.surfaceExchanges.deliver({
      exchangeId: openId, principalId: "person", params: { decision: "confirm", choice: "once" },
    }, { toolId: "delete" })).toEqual({ ok: true });
  }, { exchangeLifetime: { signal: ctx.signal, runId: "r", toolId: "delete", principalId: "person", retry: async () => {} } });
  const outcome = await requireHumanConfirm({
    ctx, spec,
    surfaces: { ...surfaces, assertAccessApprover, approvalReceiptsFor: () => ({ onApprovalReceipt: receipt }) },
    requireDeleteGrant: async () => {},
    render: ({ exchange, alternatives }) => {
      openId = exchange.id;
      expect(alternatives).toEqual([{ id: "once", label: "Once", choice: "once" }]);
      return CARD;
    },
  }, { emitSurface });
  expect(outcome).toEqual({ confirmed: true, choice: "once" });
  expect(assertAccessApprover.mock.calls).toEqual([
    [{ principalId: "person", toolId: "delete" }], [{ principalId: "person", toolId: "delete" }],
  ]);
  expect(receipt.mock.calls).toEqual([
    [{ receipt: { exchangeId: "exchange", kind: "open" }, runId: "r", principalId: "person" }, {}],
    [{ receipt: { exchangeId: "exchange", kind: "answered", confirmed: true }, runId: "r", principalId: "person" }, {}],
  ]);
  expect(surfaces.surfaceExchanges.size()).toBe(0);
});

it.each([
  { principalId: "visitor", canVerify: true, error: "delete: this access proposal belongs to another person. Nothing was changed. Request access for your own signed-in session." },
  { principalId: "person", canVerify: false, error: "delete: this chat cannot verify the person approving access. Nothing was changed. Reopen the chat in your signed-in admin session." },
])("does not render access details for $principalId (verified host available: $canVerify)", async ({ principalId, canVerify, error }) => {
  const { ctx, surfaces: { surfaceExchanges } } = approvalFixture();
  const verify = vi.fn(async () => {});
  const render = vi.fn(() => CARD);
  const emitSurface = vi.fn(async () => {});
  const result = requireHumanConfirm({
    ctx: { ...ctx, principal: { id: principalId } }, spec,
    surfaces: { surfaceExchanges, ...(canVerify ? { assertAccessApprover: verify } : {}) },
    requireDeleteGrant: async () => {}, render,
  }, { emitSurface });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toThrow(error);
  expect(surfaceExchanges.size()).toBe(0);
  expect(render.mock.calls).toEqual([]);
  expect(emitSurface.mock.calls).toEqual([]);
  expect(verify.mock.calls).toEqual([]);
});

it("returns a default cancellation result without calling the domain writer", async () => {
  const { ctx, surfaces, ordinary } = approvalFixture();
  const confirm = vi.fn(async () => ({ confirmed: false, reason: "declined" } as const));
  const run = vi.fn(async () => "changed");
  const handler = approvalToolHandler({
    surfaces, prepare: async () => "draft", describe: () => ordinary, run, confirm,
    combineDescriptions: () => { throw new Error("single item must not be combined"); },
  });
  const options = { emitSurface: async () => {} };
  expect(await handler(ctx, options)).toEqual({ executed: false, cancelled: true, note: "The user cancelled. Nothing was changed." });
  expect(confirm.mock.calls).toEqual([[{ ctx, surfaces, spec: ordinary }, options]]);
  expect(run.mock.calls).toEqual([]);
});

it("reuses a grant only for the prepared item and records the approving actor", async () => {
  const { ctx, surfaces, ordinary } = approvalFixture();
  const confirm = vi.fn(async () => ({ confirmed: true, choice: "once" } as const));
  const keys = new Set<string>();
  const run = vi.fn(async ({ prepared, confirmer, choice }: {
    prepared: string; confirmer: { id: string }; choice?: string;
  }) => ({ item: prepared, actor: confirmer.id, choice }));
  const has = vi.fn(async ({ key }: { key: string }) => keys.has(key));
  const grant = vi.fn(async ({ key }: { key: string }) => { keys.add(key); });
  const handler = approvalToolHandler({
    surfaces, prepare: async () => "draft-7", describe: () => ordinary, run, confirm,
    combineDescriptions: () => { throw new Error("single item must not be combined"); },
  }, { remembered: { has, grant }, rememberKey: ({ prepared }) => `remove:${prepared}` });
  expect(await handler(ctx)).toEqual({ item: "draft-7", actor: "person", choice: "once" });
  expect(await handler(ctx)).toEqual({ item: "draft-7", actor: "person", choice: undefined });
  expect(confirm.mock.calls).toEqual([[{ ctx, surfaces, spec: ordinary }, {}]]);
  expect(has.mock.calls).toEqual([[{ ctx, key: "remove:draft-7" }], [{ ctx, key: "remove:draft-7" }]]);
  expect(grant.mock.calls).toEqual([[{ ctx, key: "remove:draft-7", confirmer: { id: "person", kind: "user" } }]]);
});

it("requires a decision for an access change even when ordinary changes would not ask", async () => {
  const { ctx, surfaces } = approvalFixture();
  const confirm = vi.fn(async () => ({ confirmed: false, reason: "expired" } as const));
  const run = vi.fn(async () => "changed");
  const handler = approvalToolHandler({
    surfaces, prepare: async () => "change-3", describe: () => spec, run, confirm,
    combineDescriptions: () => { throw new Error("single item must not be combined"); },
  }, { ask: () => false, declined: ({ reason, prepared }) => ({ refused: reason, item: prepared }) });
  expect(await handler(ctx)).toEqual({ refused: "expired", item: "change-3" });
  expect(confirm.mock.calls).toEqual([[{ ctx, surfaces, spec }, {}]]);
  expect(run.mock.calls).toEqual([]);
});

it("asks once for a combined batch and applies the offered choice in input order", async () => {
  const { ctx, surfaces, ordinary } = approvalFixture({ items: [{ id: "b" }, { id: "a" }] });
  const confirm = vi.fn(async () => ({ confirmed: true, choice: "once" } as const));
  const handler = approvalToolHandler({
    surfaces,
    prepare: async ({ ctx: itemCtx }) => (itemCtx.input as { id: string }).id,
    describe: ({ prepared }) => ({ ...ordinary, title: `Remove ${prepared}` }),
    combineDescriptions: ({ descriptions }) => ({ ...ordinary, title: descriptions.map(({ title }) => title).join(" and ") }),
    confirm,
    run: async ({ prepared, confirmer, choice }) => ({ id: prepared, actor: confirmer.id, mode: choice }),
  }, { batch: true });
  expect(await handler(ctx)).toEqual({
    batch: true, total: 2, results: [{ id: "b", actor: "person", mode: "once" }, { id: "a", actor: "person", mode: "once" }],
  });
  expect(confirm.mock.calls).toEqual([[{ ctx, surfaces, spec: { ...ordinary, title: "Remove b and Remove a" } }, {}]]);
});

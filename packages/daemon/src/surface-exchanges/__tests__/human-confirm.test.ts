import { expect, it, vi } from "vitest";
import type { HumanConfirmSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { ToolExecutionContext, SurfaceEmitter } from "@jini-ai/core";
import { createSurfaceExchangeStore } from "../../surface-exchanges.js";
import { requireHumanConfirm } from "../human-confirm.js";

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
    const promise = requireHumanConfirm({ ctx, surfaces, spec, requireDeleteGrant: grant, render: () => "ui://confirm" }, {
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
    const outcome = await requireHumanConfirm({ ctx, surfaces: { surfaceExchanges: store }, spec: { toolId: spec.toolId, errorCode: spec.errorCode, title: spec.title, details: [], confirmLabel: spec.confirmLabel }, requireDeleteGrant: async () => {}, render: ({ exchange }) => { const close = vi.spyOn(exchange, "close"); closes.push(() => close.mock.calls.length); return "ui://confirm"; } }, { emitSurface: async () => { controller.abort(); controller.abort(); } });
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
  const outcome = await requireHumanConfirm({ ctx, surfaces: { surfaceExchanges: store, assertAccessApprover: async () => {}, approvalReceiptsFor: () => ({ onApprovalReceipt: receipt, restorable: false }) }, spec, requireDeleteGrant: async () => {}, render: () => "ui://confirm" }, { emitSurface: emit });
  expect(outcome).toEqual({ confirmed: true });
  expect(receipt).toHaveBeenCalled();
  const wrapped = open.mock.calls[0]?.[0].emit;
  expect(wrapped?.exchangeLifetime).toMatchObject({ signal: controller.signal, runId: "run", toolId: "delete", principalId: "person" });
  if (!wrapped?.exchangeLifetime) throw new Error("missing exchange lifetime");
  await wrapped.exchangeLifetime.retry({ emit, signal: controller.signal });
  expect(retry).not.toHaveBeenCalled();
});

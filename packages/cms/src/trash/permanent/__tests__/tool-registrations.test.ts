import { expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createPermanentDeleteAgentToolCatalog, createPermanentDeleteSpecs } from "../agent-tools.js";
import { buildPermanentDeleteRegistrations, contributePermanentDeleteTools, type PermanentDeleteToolDeps } from "../tool-registrations.js";

const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input: {}, signal: new AbortController().signal };

it.each(["dismissed", "stale", "denied"] as const)("%s selection performs no permanent delete", async mode => {
  const deleted = vi.fn();
  let allowed = true;
  let selection = "reviewed";
  const specs = createPermanentDeleteSpecs({ customCredentialIdSource: "read_key" });
  const deps: PermanentDeleteToolDeps = { workspaceId: "w", specs, catalog: createPermanentDeleteAgentToolCatalog({ specs }),
    authorize: async () => ({ allowed, reason: "grant" }), refuseUnexpectedKeys: () => {}, notConfirmedResult: () => ({ cancelled: true }),
    prepare: async () => { const snapshot = selection; return { details: [], execute: async () => { if (snapshot !== selection) throw new Error("selection changed"); deleted(); return { removed: true }; } }; },
    approvalToolHandler: ({ prepare, run }, { flag } = {}) => async (ctx, options = {}) => {
      const prepared = await prepare({ ctx }, options);
      if (mode === "dismissed") return { [flag!]: false, cancelled: true };
      if (mode === "stale") selection = "changed";
      if (mode === "denied") allowed = false;
      return run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, options);
    },
  };
  const tool = buildPermanentDeleteRegistrations(deps, { surfaceExchanges: {} as never }).find(item => item.descriptor.id === "trash_empty")!;
  if (mode === "dismissed") expect(await tool.handler(ctx)).toEqual({ removed: false, cancelled: true });
  else await expect(tool.handler(ctx)).rejects.toThrow(mode === "stale" ? "selection changed" : "not authorized");
  expect(deleted).not.toHaveBeenCalled();
});

it("holds a fixed row through the card and does not execute after a confirmation-time abort", async () => {
  const controller = new AbortController();
  const specs = createPermanentDeleteSpecs({ customCredentialIdSource: "read_key" });
  const details = [{ label: "Selection", value: "Asset 7" }];
  const execute = vi.fn(async () => ({ removed: true }));
  const authorize = vi.fn<PermanentDeleteToolDeps["authorize"]>(async () => ({ allowed: true, reason: "grant" }));
  const prepare = vi.fn<PermanentDeleteToolDeps["prepare"]>(async () => ({ details, execute }));
  const cards: unknown[] = [];
  const deps: PermanentDeleteToolDeps = {
    workspaceId: "w", specs, catalog: createPermanentDeleteAgentToolCatalog({ specs }), prepare, authorize,
    refuseUnexpectedKeys: (input, allowed) => {
      expect(Object.keys(input)).toEqual([...allowed]);
    },
    notConfirmedResult: ({ reason }) => ({ cancelled: true, reason }),
    approvalToolHandler: (contract, options) => async (ctx, executionOptions = {}) => {
      const prepared = await contract.prepare({ ctx }, executionOptions);
      cards.push(await contract.describe({ ctx, prepared }));
      expect(options).toEqual({ flag: "removed", batch: true });
      controller.abort();
      return contract.run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, executionOptions);
    },
  };
  const buildDeps = vi.fn((_route: { site: string }) => deps);
  const route = { site: "composed" };
  const tools = contributePermanentDeleteTools({ buildDeps }).build(route, { surfaceExchanges: {} as never });
  const tool = tools.find(item => item.descriptor.id === "media_purge_asset")!;
  await expect(tool.handler({ ...ctx, input: { mediaId: " asset-7 " }, signal: controller.signal }))
    .resolves.toEqual({ removed: false, cancelled: true, reason: "abandoned" });
  expect(cards).toEqual([expect.objectContaining({
    toolId: "media_purge_asset", errorCode: "PERMANENT_DELETE", danger: true, details,
    warning: "Permanent deletion has no undo or restore.", confirmLabel: "Permanently delete",
  })]);
  expect(buildDeps).toHaveBeenCalledExactlyOnceWith(route);
  expect(prepare).toHaveBeenCalledExactlyOnceWith("media_purge_asset", "asset-7", "owner");
  expect(authorize.mock.calls.map(([request]) => request)).toEqual(Array.from({ length: 2 }, () => ({
    workspaceId: "w", principalId: "owner", permission: "media.delete.force", entityType: "media", entityId: "asset-7",
  })));
  expect(execute).not.toHaveBeenCalled();
});

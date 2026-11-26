import { expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createPermanentDeleteAgentToolCatalog, createPermanentDeleteSpecs } from "../agent-tools.js";
import { buildPermanentDeleteRegistrations, type PermanentDeleteToolDeps } from "../tool-registrations.js";

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

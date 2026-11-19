import { describe, expect, it, vi } from "vitest";
import { ToolInputError, type ToolExecutionContext, type ToolExecutionOptions, type ToolRegistration } from "@jini-ai/core";
import { buildTrashItemAgentToolCatalog, deriveTrashItemRegistrations, moveToTrashOutcomeToError,
  trashItemDerivedRisk, TRASH_ITEM_TOOL_ID, type TrashItemDelegate, type TrashItemToolDeps } from "../trash-item-tool.js";
import type { TrashEntry } from "../registry-types.js";

const entry: TrashEntry = {
  entityType: "form", label: "Form", permission: "forms.delete", table: "forms", idColumn: "id",
  workspaceColumn: "workspace_id", marker: { kind: "timestamp", column: "deleted_at" },
  versionColumn: "version", display: { title: "forms.title" },
};
const presentation = {
  description: "Exact catalog copy; punctuation.", entityTypeDescription: "Exact kind copy.",
  entityIdDescription: "That thing's own id.", floorPermission: "catalog.read", aliases: new Map([["page", "post"]]),
};

function fixture() {
  const order: string[] = [];
  const live = new Set(["form", "user", "post"]);
  const authorize = vi.fn(async () => { order.push("authorize"); return { allowed: true, reason: "grant" }; });
  const read = vi.fn(async (_required: Parameters<TrashItemToolDeps["readLiveVersion"]>[0]): Promise<{ version: number | null } | null> => {
    order.push("read"); return { version: 7 };
  });
  const move = vi.fn(async (_required: Parameters<TrashItemToolDeps["moveToTrash"]>[0]): ReturnType<TrashItemToolDeps["moveToTrash"]> => {
    order.push("move"); return { ok: true, version: 8 };
  });
  const deps: TrashItemToolDeps = {
    workspaceId: "ws", authorize, registry: new Map([["form", entry]]), delegates: new Map(),
    isTrashableEntityType: ({ entityType }) => live.has(entityType),
    readLiveVersion: read, moveToTrash: move, actorPluginId: "agent-marker", userKind: "user", presentation,
    metadata: { trash_item: { title: "Host title", approval: { class: "trash", confirmation: "direct" } } },
  };
  return { deps, order, live, authorize, read, move };
}

function context(entityType = "form"): ToolExecutionContext {
  return { executionId: "exec", principal: { id: "human" }, run: { id: "run" },
    input: { entityType, entityId: "item" }, signal: new AbortController().signal };
}

function handler(deps: TrashItemToolDeps, registrations: readonly ToolRegistration[] = []) {
  return deriveTrashItemRegistrations({ registrations, deps })[0]!.handler;
}

const delegate: TrashItemDelegate = {
  entityType: "form", toolId: "forms_delete", permission: "delegate.delete",
  toDelegateInput: async ({ entityId }) => ({ id: entityId }),
};

describe("trash_item", () => {
  it("authorizes, snapshots, then moves with the exact version and actor", async () => {
    const h = fixture();
    const emitSurface = vi.fn();
    expect(await handler(h.deps)(context(), { emitSurface })).toEqual({ entityType: "form", entityId: "item", via: "moveToTrash",
      outcome: { trashed: true, cancelled: false, version: 8 } });
    expect(emitSurface).not.toHaveBeenCalled();
    expect(h.order).toEqual(["authorize", "read", "move"]);
    expect(h.authorize).toHaveBeenCalledWith({ principalId: "human", permission: "forms.delete",
      workspaceId: "ws", entityType: "form", entityId: "item" });
    expect(h.read).toHaveBeenCalledWith({ entry, workspaceId: "ws", entityId: "item" });
    expect(h.move).toHaveBeenCalledWith({ workspaceId: "ws", entityType: "form", entityId: "item",
      actor: { principalId: "human", pluginId: "agent-marker" }, expectedVersion: 7 });
  });

  it("does not read or move when permission is denied", async () => {
    const h = fixture();
    h.authorize.mockResolvedValue({ allowed: false, reason: "denied" });
    await expect(handler(h.deps)(context())).rejects.toThrow("not authorized for 'forms.delete'");
    expect(h.read).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });

  it("refuses a missing snapshot without moving and preserves null-version handling", async () => {
    const h = fixture();
    h.read.mockResolvedValueOnce(null);
    await expect(handler(h.deps)(context())).rejects.toThrow("trash_item: form 'item' was not found. Nothing was changed.");
    expect(h.move).not.toHaveBeenCalled();
    h.read.mockResolvedValueOnce({ version: null });
    await handler(h.deps)(context());
    expect(h.move.mock.calls[0]![0].expectedVersion).toBeUndefined();
  });

  it("preserves a version-race refusal with zero simulated writes", async () => {
    const h = fixture();
    const writes: string[] = [];
    h.move.mockImplementation(async (required) => {
      if (required.expectedVersion !== 8) return { ok: false, reason: "version-changed" };
      writes.push("write"); return { ok: true, version: 9 };
    });
    await expect(handler(h.deps)(context())).rejects.toThrow("trash_item: form 'item' changed during removal. Reload and try again. Nothing was changed.");
    expect(writes).toEqual([]);
    expect(h.move.mock.calls[0]![0].expectedVersion).toBe(7);
  });

  it("prefers the registered delegate, forwarding context and identical options on decline", async () => {
    const h = fixture();
    const declined = { trashed: false, cancelled: true };
    const resolve = vi.fn(async ({ entityId }: { entityId: string }) => { h.order.push("resolve"); return { id: entityId }; });
    h.deps.delegates = new Map([["form", { ...delegate, toDelegateInput: resolve }]]);
    const run = vi.fn(async (_ctx: ToolExecutionContext, _options?: ToolExecutionOptions) => { h.order.push("delegate"); return declined; });
    const registrations: ToolRegistration[] = [{ descriptor: { id: "forms_delete" }, policy: { authorize: () => "allow" }, handler: run }];
    const ctx = context();
    const options: ToolExecutionOptions = { onApprovalStateChange: vi.fn() };
    const result = await handler(h.deps, registrations)(ctx, options) as { outcome: unknown };
    expect(result).toEqual({ entityType: "form", entityId: "item", via: "forms_delete", outcome: declined });
    expect(result.outcome).toBe(declined);
    expect(run).toHaveBeenCalledWith({ ...ctx, input: { id: "item" } }, options);
    expect(run.mock.calls[0]![0].signal).toBe(ctx.signal);
    expect(run.mock.calls[0]![1]).toBe(options);
    expect(h.order).toEqual(["authorize", "resolve", "delegate"]);
    expect(resolve).toHaveBeenCalledWith({ entityId: "item" });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });

  it("checks the delegate permission before resolving input", async () => {
    const h = fixture();
    const resolve = vi.fn(delegate.toDelegateInput);
    h.deps.delegates = new Map([["form", { ...delegate, toDelegateInput: resolve }]]);
    h.authorize.mockResolvedValue({ allowed: false, reason: "denied" });
    await expect(handler(h.deps, [{ descriptor: { id: delegate.toolId }, policy: { authorize: () => "allow" }, handler: async () => ({}) }])(context()))
      .rejects.toThrow("not authorized for 'delegate.delete'");
    expect(resolve).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });

  it("refuses a missing delegated input before invoking the delegate", async () => {
    const h = fixture();
    h.deps.delegates = new Map([["form", { ...delegate, toDelegateInput: async () => null }]]);
    const run = vi.fn(async () => ({}));
    await expect(handler(h.deps, [{ descriptor: { id: delegate.toolId }, policy: { authorize: () => "allow" }, handler: run }])(context()))
      .rejects.toThrow("trash_item: form 'item' was not found. Nothing was changed.");
    expect(run).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });

  it("uses registry fallback when the delegate's tool is not registered", async () => {
    const h = fixture();
    const resolve = vi.fn(delegate.toDelegateInput);
    h.deps.delegates = new Map([["form", { ...delegate, toDelegateInput: resolve }]]);
    await handler(h.deps)(context());
    expect(resolve).not.toHaveBeenCalled();
    expect(h.order).toEqual(["authorize", "read", "move"]);
  });

  it("rechecks live membership after construction and reads registry on each derivation", async () => {
    const h = fixture();
    const run = handler(h.deps);
    h.live.delete("form");
    await expect(run(context())).rejects.toThrow("Expected one of: . Nothing was changed.");
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
    h.deps.registry = new Map();
    expect(deriveTrashItemRegistrations({ registrations: [], deps: h.deps })).toEqual([]);
  });

  it("forwards direct user IDs and preserves no-op without a generic precheck", async () => {
    const h = fixture();
    const trashUser = vi.fn(async () => ({ noop: true }));
    const registration = deriveTrashItemRegistrations({ registrations: [], deps: h.deps }, { trashUser })[0]!;
    const emitSurface = vi.fn();
    expect(await registration.handler(context("user"), { emitSurface })).toEqual({ entityType: "user", entityId: "item", via: "trashUser",
      outcome: { trashed: true, cancelled: false, alreadyInTrash: true } });
    expect(emitSurface).not.toHaveBeenCalled();
    expect(trashUser).toHaveBeenCalledWith({ principalId: "item", callerPrincipalId: "human" });
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
    h.live.delete("user");
    await expect(registration.handler(context("user"))).rejects.toBeInstanceOf(ToolInputError);
    expect(trashUser).toHaveBeenCalledTimes(1);
  });

  it("uses the host's user kind and lets its port's refusal escape unchanged", async () => {
    const h = fixture();
    h.deps.userKind = "account";
    h.live.add("account");
    const refusal = new ToolInputError({ message: "owner refusal" });
    const trashUser = vi.fn(async () => { throw refusal; });
    const run = deriveTrashItemRegistrations({ registrations: [], deps: h.deps }, { trashUser })[0]!.handler;
    await expect(run(context("account"))).rejects.toBe(refusal);
    expect(trashUser).toHaveBeenCalledWith({ principalId: "item", callerPrincipalId: "human" });
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });

  it("does not accept user without its bound port", async () => {
    const h = fixture();
    await expect(handler(h.deps)(context("user"))).rejects.toBeInstanceOf(ToolInputError);
    expect(h.move).not.toHaveBeenCalled();
  });

  it("binds host catalog copy, aliases, floor permission, metadata and independent risk", async () => {
    const catalog = buildTrashItemAgentToolCatalog({ kinds: ["post", "form"], presentation });
    expect(catalog).toEqual([{ name: "trash_item", description: presentation.description,
      sideEffects: "deletes-durable-state", authorization: { permission: "catalog.read" }, inputSchema: {
        type: "object", additionalProperties: false, required: ["entityType", "entityId"], properties: {
          entityType: { type: "string", enum: ["post", "form", "page"], aliases: ["kind"], description: presentation.entityTypeDescription },
          entityId: { type: "string", minLength: 1, description: presentation.entityIdDescription },
        },
      } }]);
    expect([...trashItemDerivedRisk]).toEqual([[TRASH_ITEM_TOOL_ID, "deletes-durable-state"]]);
    const h = fixture();
    h.deps.registry = new Map([["post", { ...entry, entityType: "post" }]]);
    const registration = deriveTrashItemRegistrations({ registrations: [], deps: h.deps })[0]!;
    expect(registration.descriptor.metadata).toBe(h.deps.metadata.trash_item);
    expect(await registration.handler(context("page"))).toMatchObject({ entityType: "post" });
  });

  it.each([
    [{ reason: "not-found" }, "trash_item: form 'item' was not found. Nothing was changed."],
    [{ reason: "forbidden", permission: "forms.delete" }, "trash_item: not authorized for 'forms.delete'. Nothing was changed."],
    [{ reason: "version-changed" }, "trash_item: form 'item' changed during removal. Reload and try again. Nothing was changed."],
    [{ reason: "unknown-type" }, "trash_item: 'form' is not a kind of thing the Trash can hold. Nothing was changed."],
    [{ reason: "blocked", code: "CHILDREN" }, "trash_item: could not move form 'item' to the Trash: blocked (CHILDREN). Nothing was changed."],
    [{ reason: "future" }, "trash_item: could not move form 'item' to the Trash: future. Nothing was changed."],
  ] as const)("retains refusal mapping %#", (outcome, message) => {
    const error = moveToTrashOutcomeToError({ entityType: "form", entityId: "item", outcome: { ok: false, ...outcome } });
    expect(error).toBeInstanceOf(ToolInputError);
    expect(error.message).toBe(message);
  });
});

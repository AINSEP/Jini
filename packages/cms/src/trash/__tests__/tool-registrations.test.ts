import { describe, expect, it } from "vitest";
import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { buildTrashAgentToolCatalog, buildTrashToolRegistrations, trashDerivedRisk, type TrashItem, type TrashPackageToolDeps, type TrashPort, type TrashToolPolicy } from "../index.js";

const WORKSPACE_ID = "ws-1";
const NOW = "2026-09-20T12:00:00.000Z";

function item(overrides: Partial<TrashItem> & Pick<TrashItem, "id" | "entityType" | "entityId">): TrashItem {
  return {
    workspaceId: WORKSPACE_ID,
    trashedAt: NOW,
    purgeAfter: "2026-09-27T12:00:00.000Z",
    actorPrincipalId: "principal-1",
    actorPluginId: null,
    displayTitle: `title of ${overrides.entityId}`,
    displaySubtitle: null,
    entityVersion: 2,
    priorMarker: null,
    ...overrides,
  };
}

interface Harness {
  registrations: ToolRegistration[];
  restoreCalls: Array<{ entityType: string; entityId: string; actor: unknown }>;
  listCalls: unknown[];
  permissionsChecked: string[];
}

function harness(options: { items?: TrashItem[]; outcome?: "restored" | "not-found"; policy?: Partial<TrashToolPolicy>; granted?: readonly string[]; listUsers?: TrashPackageToolDeps["userRepo"]["list"] } = {}): Harness {
  const granted = new Set(options.granted ?? ["read", "write"]);
  const restoreCalls: Harness["restoreCalls"] = [];
  const listCalls: unknown[] = [];
  const permissionsChecked: string[] = [];
  const trash: TrashPort = {
    async trash() {
      return { ok: true, version: 1 };
    },
    async restore(required, restoreOptional = {}) {
      restoreCalls.push({ entityType: required.entityType, entityId: required.entityId, actor: restoreOptional.actor });
      return options.outcome ?? "restored";
    },
    async list(required, listOptional = {}) {
      listCalls.push({ ...required, ...listOptional });
      return { items: options.items ?? [item({ id: "row-1", entityType: "post", entityId: "post-1" })], nextCursor: "cursor-2" };
    },
    async purgeSelected() {
      throw new Error("purgeSelected must never be reached from a tool handler");
    },
  };
  const policy: TrashToolPolicy = {
    permissionFor: (entityType) => (entityType === "post" ? "write" : null),
    readPermission: "read",
    filterVisible: async ({ items }) => items.filter((row) => row.entityType === "post"),
    daysRemaining: ({ now, until }) => Math.max(0, Math.ceil((Date.parse(until) - Date.parse(now)) / 86_400_000)),
    messageKinds: () => ["post", "post", "media"],
    catalogKinds: () => ["post", "media"],
    ...options.policy,
  };
  const deps: TrashPackageToolDeps = {
    workspaceId: WORKSPACE_ID,
    clock: { nowIso: () => NOW },
    trash,
    userRepo: { list: options.listUsers ?? (async () => [{ principalId: "principal-1", username: "alice" }]) },
    trashPolicy: policy,
    authorize: async (params) => {
      permissionsChecked.push(params.permission);
      return granted.has(params.permission) ? { allowed: true, reason: "matched" } : { allowed: false, reason: `missing ${params.permission}` };
    },
  };
  return { registrations: buildTrashToolRegistrations({ deps }), restoreCalls, listCalls, permissionsChecked };
}

function ctx(input: unknown): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: "principal-9" }, run: { id: "run-1" }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

const call = (h: Harness, id: string, input: unknown) => h.registrations.find((r) => r.descriptor.id === id)!.handler(ctx(input));

describe("buildTrashToolRegistrations", () => {
  it("wires exactly the two tools, in order, with the authored risk map", () => {
    const h = harness();
    expect(h.registrations.map((r) => r.descriptor.id)).toEqual(["trash_list_items", "trash_restore_item"]);
    expect([...trashDerivedRisk.entries()]).toEqual([["trash_list_items", "none"], ["trash_restore_item", "mutates-durable-state"]]);
  });

  it("lists the visible rows as the model-facing view with the resolved actor and the days left", async () => {
    const h = harness({ items: [item({ id: "row-1", entityType: "post", entityId: "post-1", actorPluginId: "assistant" }), item({ id: "row-2", entityType: "comment", entityId: "c-1" })] });
    expect(await call(h, "trash_list_items", {})).toEqual({
      items: [{ trashItemId: "row-1", entityType: "post", entityId: "post-1", title: "title of post-1", subtitle: null, deletedAt: NOW, deletedBy: "alice + AI", permanentlyRemovedAfter: "2026-09-27T12:00:00.000Z", daysRemaining: 7 }],
      nextCursor: "cursor-2",
    });
    expect(h.permissionsChecked).toEqual(["read"]);
  });

  it("names the system actor and falls back to a plain label for an unknown account", async () => {
    const h = harness({ items: [item({ id: "r1", entityType: "post", entityId: "p1", actorPrincipalId: "system" }), item({ id: "r2", entityType: "post", entityId: "p2", actorPrincipalId: "gone" })] });
    const listed = (await call(h, "trash_list_items", undefined)) as { items: Array<{ deletedBy: string }> };
    expect(listed.items.map((row) => row.deletedBy)).toEqual(["system", "deleted user"]);
  });

  it("keeps the next cursor on a fully hidden page without querying actor names", async () => {
    const h = harness({ items: [item({ id: "private", entityType: "comment", entityId: "comment-1" })],
      listUsers: async () => { throw new Error("no visible actors to query"); } });
    expect(await call(h, "trash_list_items", {})).toEqual({ items: [], nextCursor: "cursor-2" });
    expect(h.listCalls).toEqual([{ workspaceId: WORKSPACE_ID, now: NOW, limit: 25, cursor: null }]);
  });

  it("forwards the workspace, clock, limit, cursor and kind filter to the port", async () => {
    const h = harness();
    await call(h, "trash_list_items", { limit: 5, cursor: "c1", entityTypes: ["post"] });
    expect(h.listCalls).toEqual([{ workspaceId: WORKSPACE_ID, now: NOW, limit: 5, entityTypes: ["post"], cursor: "c1" }]);
  });

  it("rejects a malformed entityTypes filter with a ToolInputError", async () => {
    await expect(call(harness(), "trash_list_items", { entityTypes: [1] })).rejects.toBeInstanceOf(ToolInputError);
  });

  it("refuses a list without the entry permission before reading", async () => {
    const h = harness({ granted: ["write"] });
    await expect(call(h, "trash_list_items", {})).rejects.toThrow("not authorized for 'read'");
    expect(h.listCalls).toEqual([]);
  });

  it("restores through the port with the calling principal and the assistant plugin as the actor", async () => {
    const h = harness();
    expect(await call(h, "trash_restore_item", { entityType: "post", entityId: "p1" })).toEqual({ restored: true, entityType: "post", entityId: "p1" });
    expect(h.restoreCalls).toEqual([{ entityType: "post", entityId: "p1", actor: { principalId: "principal-9", pluginId: "assistant" } }]);
    expect(h.permissionsChecked).toEqual(["write"]);
  });

  it("reports a non-restored outcome with its reason and note instead of throwing", async () => {
    const h = harness({ outcome: "not-found" });
    expect(await call(h, "trash_restore_item", { entityType: "post", entityId: "p1" })).toEqual({
      restored: false, reason: "not-found", entityType: "post", entityId: "p1",
      note: "That item is not in the Trash. It may have been restored already, or permanently removed.",
    });
  });

  it("refuses a restore without the kind's permission and never reaches the port", async () => {
    const h = harness({ granted: ["read"] });
    await expect(call(h, "trash_restore_item", { entityType: "post", entityId: "p1" })).rejects.toThrow("not authorized for 'write'");
    expect(h.restoreCalls).toEqual([]);
  });

  it("refuses an unknown kind with a ToolInputError that lists the policy's message kinds as given", async () => {
    const h = harness();
    await expect(call(h, "trash_restore_item", { entityType: "ghost", entityId: "g" })).rejects.toSatisfy((error: unknown) => error instanceof ToolInputError && error.message === "trash_restore_item: 'ghost' is not a kind the Trash can restore. Expected one of: post, post, media.");
    expect(h.restoreCalls).toEqual([]);
  });

  it("publishes the policy's catalog kinds in both tools' entityType enums", () => {
    const catalog = buildTrashAgentToolCatalog({ kinds: ["post", "media"] });
    expect(catalog.map((tool) => tool.name)).toEqual(["trash_list_items", "trash_restore_item"]);
    expect(JSON.stringify(catalog[1]!.inputSchema)).toContain('"enum":["post","media"]');
    const h = harness({ policy: { catalogKinds: () => ["media"] } });
    expect(JSON.stringify(h.registrations[1]!.descriptor.inputSchema)).toContain('"enum":["media"]');
  });

  it("builds the catalog per call, so a kind registered later reaches the next build", () => {
    let kinds = ["post"];
    const policyKinds = () => kinds;
    expect(JSON.stringify(harness({ policy: { catalogKinds: policyKinds } }).registrations[0]!.descriptor.inputSchema)).toContain('"enum":["post"]');
    kinds = ["post", "form"];
    expect(JSON.stringify(harness({ policy: { catalogKinds: policyKinds } }).registrations[0]!.descriptor.inputSchema)).toContain('"enum":["post","form"]');
  });
});

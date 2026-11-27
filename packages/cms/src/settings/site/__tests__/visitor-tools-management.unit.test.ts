import { expect, it, vi } from "vitest";
import { ToolInputError, type AgentToolDefinition, type ToolExecutionContext } from "@jini-ai/core";
import type { VisitorToolChoice, VisitorToolDescriptor } from "@jini-ai/core/contracts/site/site-assistant-visitor-tools-management";
import { ForbiddenError, InMemorySettingsRepo, resolveDefinitionRaw, type SetValueRequired, type SettingDefinitionRecord } from "@jini-ai/core/settings";
import type { JsonValue } from "@jini-ai/core/primitives";

import type { VisitorToolsHostContract } from "../visitor-tools-contract.js";
import { contributeVisitorTools, type VisitorToolsApprovalHandlerPort, type VisitorToolsConfigureCard } from "../visitor-tools-registrations.js";
import { createVisitorToolsManagement } from "../visitor-tools-service.js";
import { readVisitorToolsRevision, readVisitorToolsSnapshot, VisitorToolsRevisionConflictError, writeVisitorTools } from "../visitor-tools-write.js";

class ValidationError extends Error {}
const defaults = { perIpPerHour: 3, perSitePerDay: 10 };
const off = { mode: "off", limits: defaults } as const;
const now = "2026-11-24T00:00:00.000Z";
const workspaceId = "studio";
const callerPrincipalId = "owner";
const tool: VisitorToolDescriptor = {
  id: "lookup", title: "Listing lookup", description: "Find public listings",
  source: "created", sourceRevision: "review-7", effect: "read", availability: { available: true },
  publication: { endpoint: "https://catalog.example.test/listings", credentialId: "public-listing-reader", returnedFields: ["title", "location"] },
};

const visitorTools: VisitorToolsHostContract = {
  setting: { namespace: "core.visitor", key: "policy" }, permission: "visitor.manage",
  defaultLimits: defaults, callsPerTurn: 4, resolveDefinitionRaw, ValidationError,
  object: ({ value, keys }) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected an input object.");
    const record = value as Record<string, unknown>;
    if (keys && Object.keys(record).some(key => !keys.includes(key))) throw new ValidationError("Unexpected input key.");
    return record;
  },
  parsePolicy: ({ value }) => {
    if (value === null || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("tools" in value)) {
      throw new ValidationError("Unreadable visitor-tool policy.");
    }
    if (value.tools === null || typeof value.tools !== "object" || Array.isArray(value.tools)) throw new ValidationError("Expected tool choices.");
    const tools = value.tools as Record<string, VisitorToolChoice>;
    for (const choice of Object.values(tools)) {
      if (!["auto", "ask", "off"].includes(choice.mode) || !Number.isSafeInteger(choice.limits.perIpPerHour) || !Number.isSafeInteger(choice.limits.perSitePerDay)) {
        throw new ValidationError("Invalid tool choice.");
      }
    }
    return { version: 1, tools };
  },
  resolveChoice: ({ policy, toolId }) => policy.tools[toolId] ?? off,
};

const definition: SettingDefinitionRecord = {
  settingId: "visitor-policy", ...visitorTools.setting, workspaceId: null, version: 1, ownerKind: "core", ownerId: null,
  schema: { type: "json" }, defaultValue: { version: 1, tools: {} }, scopes: 2, secret: false, status: "active",
  aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: now, updatedAt: now,
};

function fixture({ initial, registered = true, catalog = [tool] }: { initial?: JsonValue; registered?: boolean; catalog?: VisitorToolDescriptor[] } = {}) {
  const repo = new InMemorySettingsRepo({
    definitions: registered ? [definition] : [],
    workspaceValues: initial === undefined ? [] : [{
      settingId: definition.settingId, workspaceId, principalId: null, scope: "workspace", state: "set", valueJson: initial, defVersion: 1,
      seq: 0, updatedAt: now, updatedBy: callerPrincipalId, originPluginId: null,
    }],
  });
  const grants: Parameters<SetValueRequired["deps"]["authorize"]>[0][] = [];
  let allowed = true;
  let next = 0;
  const settings: SetValueRequired["deps"] = {
    repo, clock: { nowMs: () => Date.parse(now) }, ids: { newId: () => `audit-${++next}` }, principals: { findActiveById: async () => null },
    authorize: async (request) => {
      grants.push(request);
      return { allowed: allowed && request.permission === "visitor.manage" && request.principalId === callerPrincipalId && request.workspaceId === workspaceId, reason: "test" };
    },
  };
  const writePolicies = { dedicatedWriters: [{ ...visitorTools.setting, permissionOverride: "visitor.manage", reason: "Use visitor management." }] };
  const listCatalog = vi.fn(async () => catalog);
  const management = createVisitorToolsManagement({ deps: { workspaceId, settings, ready: Promise.resolve(), listCatalog, visitorTools, writePolicies } });
  return {
    repo, grants, management, listCatalog, deny: () => { allowed = false; },
    store: { repo, workspaceId, visitorTools },
    writer: { deps: settings, workspaceId, callerPrincipalId, visitorTools, writePolicies },
  };
}

const buildInput = (props: Record<string, unknown> = {}) => ({ callerPrincipalId, input: { toolId: "lookup", mode: "ask", expectedRevisionSeq: 0, ...props } });

it("prepares public access without writing, then saves only the approved choice through the dedicated grant", async () => {
  const f = fixture();
  const prepared = await f.management.prepare(buildInput({ limits: { perSitePerDay: 18 } }));
  const next = { mode: "ask", limits: { perIpPerHour: 3, perSitePerDay: 18 } };
  expect(prepared).toEqual({ revisionSeq: 0, catalog: [tool], changes: [{ tool: { ...tool, ...off }, previous: off, next }],
    requiresApproval: true, policy: { version: 1, tools: { lookup: next } } });
  expect(await readVisitorToolsSnapshot(f.store)).toEqual({ revisionSeq: 0, policy: { version: 1, tools: {} } });
  expect(await f.management.apply({ callerPrincipalId, prepared })).toEqual({
    revisionSeq: 1, defaults, callsPerTurn: 4, tools: [{ ...tool, ...next }],
  });
  expect(await f.management.list({ callerPrincipalId })).toMatchObject({ revisionSeq: 1, tools: [{ ...tool, ...next }] });
  expect(await readVisitorToolsRevision(f.store)).toBe(1);
  expect(f.grants.map(({ workspaceId, principalId, permission }) => ({ workspaceId, principalId, permission }))).toEqual(
    Array.from({ length: 4 }, () => ({ workspaceId: "studio", principalId: "owner", permission: "visitor.manage" })),
  );
});

it("refuses approval after either a source revision change or revocation and leaves the policy untouched", async () => {
  const catalog = [tool];
  const f = fixture({ catalog });
  const prepared = await f.management.prepare(buildInput());
  catalog[0] = { ...tool, sourceRevision: "review-8" };
  await expect(f.management.apply({ callerPrincipalId, prepared })).rejects.toThrow(
    new VisitorToolsRevisionConflictError("Visitor tool sources changed. List them again and review the new targets."));
  f.deny();
  await expect(f.management.apply({ callerPrincipalId, prepared })).rejects.toThrow(new ForbiddenError("visitor.manage is required."));
  expect(f.listCatalog.mock.calls).toEqual([[{}], [{}]]);
  expect(await f.repo.listRevisions({ settingId: definition.settingId })).toEqual([]);
});

it("corrupt storage is disarmed and can only be repaired with an explicit site-wide Off", async () => {
  const f = fixture({ initial: { version: 9, tools: { lookup: { mode: "auto", limits: defaults } } } });
  expect(await f.management.list({ callerPrincipalId })).toEqual({
    revisionSeq: 0, policyState: "invalid", defaults, callsPerTurn: 4, tools: [{ ...tool, ...off }],
  });
  await expect(f.management.prepare(buildInput({ mode: "off" }))).rejects.toThrow(
    new ValidationError("Stored visitor-tools policy is unreadable; turn all tools Off to reset it."));
  const prepared = await f.management.prepare(buildInput({ toolId: "site", mode: "off" }));
  expect(prepared.requiresApproval).toBe(false);
  await f.management.apply({ callerPrincipalId, prepared });
  expect(await readVisitorToolsSnapshot(f.store)).toEqual({ revisionSeq: 1, policy: { version: 1, tools: { lookup: off } } });
});

it("shows a removed configured tool as unavailable and allows it to be turned Off but not republished", async () => {
  const f = fixture({ initial: { version: 1, tools: { retired: { mode: "auto", limits: defaults } } } });
  const view = await f.management.list({ callerPrincipalId });
  expect(view.tools.find(item => item.id === "retired")).toMatchObject({
    source: "unavailable", mode: "auto", availability: { available: false, reason: "Source is unavailable or has no reviewed visitor declaration." },
  });
  await expect(f.management.prepare(buildInput({ toolId: "missing" }))).rejects.toThrow(
    new ValidationError("Tool is unavailable. List visitor tools and choose a current id."));
  await expect(f.management.prepare(buildInput({ toolId: "retired", mode: "auto" }))).rejects.toThrow(
    new ValidationError("An unavailable tool can only be switched Off."));
  const prepared = await f.management.prepare(buildInput({ toolId: "retired", mode: "off" }));
  expect(prepared.requiresApproval).toBe(false);
  await f.management.apply({ callerPrincipalId, prepared });
  expect((await readVisitorToolsSnapshot(f.store)).policy?.tools.retired).toEqual(off);
});

it("rejects stale preparation and rolls back a stale approved write without consuming a revision", async () => {
  const f = fixture();
  const stale = await f.management.prepare(buildInput());
  await writeVisitorTools({ ...f.writer, value: { version: 1, tools: { lookup: off } } });
  await expect(f.management.prepare(buildInput())).rejects.toThrow(
    new VisitorToolsRevisionConflictError("Visitor tools changed. List them again before retrying."));
  await expect(f.management.apply({ callerPrincipalId, prepared: stale })).rejects.toThrow(
    new VisitorToolsRevisionConflictError("Visitor tools changed. List them again before retrying."));
  expect(await readVisitorToolsSnapshot(f.store)).toEqual({ revisionSeq: 1, policy: { version: 1, tools: { lookup: off } } });
  expect((await f.repo.listRevisions({ settingId: definition.settingId })).map(row => row.seq)).toEqual([1]);
});

it("does not substitute an upgrade-policy default for an unregistered definition, and propagates ledger faults", async () => {
  const unregistered = fixture({ registered: false });
  await expect(readVisitorToolsSnapshot(unregistered.store)).rejects.toThrow("Visitor-tools policy definition is unavailable.");
  const f = fixture();
  const outage = new Error("ledger offline");
  f.repo.getWorkspaceValue = async () => { throw outage; };
  await expect(f.management.list({ callerPrincipalId })).rejects.toBe(outage);
});

it("rejects duplicate, reserved and out-of-bounds source catalogs instead of presenting ambiguous targets", async () => {
  for (const [catalog, message] of [
    [[tool, { ...tool, sourceRevision: "other" }], "Invalid visitor catalog identity."],
    [[{ ...tool, id: "site" }], "Invalid visitor catalog identity."],
    [Array.from({ length: 129 }, (_, i) => ({ ...tool, id: `lookup${i}` })), "Visitor catalog exceeds its supported bound."],
  ] as const) {
    const f = fixture({ catalog: [...catalog] });
    await expect(f.management.list({ callerPrincipalId })).rejects.toThrow(message);
  }
});

it("can switch Off a dotted tool identity that the service listed as eligible", async () => {
  const f = fixture({ catalog: [{ ...tool, id: "catalog.lookup" }] });
  expect((await f.management.list({ callerPrincipalId })).tools.map(item => item.id)).toEqual(["catalog.lookup"]);
  const prepared = await f.management.prepare(buildInput({ toolId: "catalog.lookup", mode: "off" }));
  expect(prepared.policy.tools["catalog.lookup"]).toEqual(off);
});

function toolsFixture(f: ReturnType<typeof fixture>, { composed = true, confirm = true }: { composed?: boolean; confirm?: boolean } = {}) {
  const cards: VisitorToolsConfigureCard[] = [];
  const approvalToolHandler: VisitorToolsApprovalHandlerPort = (required, policy) => async (ctx) => {
    const prepared = await required.prepare({ ctx });
    const shouldAsk = policy.ask({ prepared });
    const card = required.describe({ ctx, prepared });
    cards.push(card);
    if (shouldAsk && !confirm) return { changed: false };
    return required.run({ ctx, prepared });
  };
  const ids = ["visitor_tools_list", "visitor_tool_configure", "visitor_tool_save", "visitor_tool_delete"];
  const catalog = ids.map((name): AgentToolDefinition => ({
    name, description: `Fixture ${name}`, sideEffects: name === "visitor_tool_configure" ? "mutates-durable-state" : "none",
    authorization: { permission: "visitor.manage" }, inputSchema: { type: "object" },
  }));
  const contributor = contributeVisitorTools({ hostPolicy: { catalog, catalogModule: "fixture", toolMetadata: {}, approvalToolHandler, visitorTools } });
  const registrations = contributor.build({ workspaceId, ...(composed ? { visitorToolsManagement: f.management } : {}) }, {
    surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: () => 0 },
  });
  const run = (id: string, input: unknown) => {
    const registration = registrations.find(item => item.descriptor.id === id);
    if (!registration) throw new Error(`Missing visitor tool ${id}`);
    const ctx: ToolExecutionContext = {
      executionId: "run-tool", run: { id: "admin-run" }, principal: { id: callerPrincipalId }, signal: new AbortController().signal, input,
    };
    return registration.handler(ctx);
  };
  return { cards, run };
}

it("a declined publication card exposes the exact source, proposed access and revision but does not save", async () => {
  const f = fixture();
  const { cards, run } = toolsFixture(f, { confirm: false });
  await expect(run("visitor_tool_configure", buildInput({ mode: "auto", limits: { perSitePerDay: 1200 } }).input)).resolves.toEqual({ changed: false });
  expect(cards).toEqual([{
    toolId: "visitor_tool_configure", errorCode: "VISITOR_TOOLS", title: "Change public visitor tool access?",
    description: "This changes what anonymous visitors may access. Your confirmation applies only to these changes and is never remembered.",
    confirmLabel: "Confirm public access", details: [
      { label: "Sends requests to", value: "https://catalog.example.test/listings" },
      { label: "Uses credential", value: "public-listing-reader" },
      { label: "Shares fields", value: "title, location" },
    ], access: { resources: [{
      id: "lookup", label: "Listing lookup", scope: { personId: "owner", siteId: "studio" }, revision: "0:review-7",
      previous: { Mode: "Off", "Per visitor": "3/hour", "Whole site": "10/day" },
      proposed: { Mode: "Auto", "Per visitor": "3/hour", "Whole site": "1,200/day" },
    }] },
  }]);
  expect(await f.repo.listRevisions({ settingId: definition.settingId })).toEqual([]);
});

it("routes safe reductions directly and maps stale requests to explicit reload guidance", async () => {
  const { publication: _publication, ...undisclosed } = tool;
  const f = fixture({ catalog: [undisclosed] });
  const { cards, run } = toolsFixture(f);
  await expect(run("visitor_tool_configure", buildInput({ mode: "off" }).input)).resolves.toMatchObject({ revisionSeq: 1, tools: [{ id: "lookup", ...off }] });
  expect(cards).toEqual([expect.objectContaining({ toolId: "visitor_tool_configure", details: [] })]);
  expect(cards[0]?.access).toBeUndefined();
  await expect(run("visitor_tool_configure", buildInput().input)).resolves.toEqual({
    changed: false, code: "VISITOR_TOOLS_REVISION_CONFLICT", reload: true, note: "Visitor tools changed. List them again before retrying.",
  });
});

it("list and deferred source tools validate inputs and remain permission gated", async () => {
  const f = fixture();
  const { run } = toolsFixture(f);
  await expect(run("visitor_tools_list", {})).resolves.toEqual({ revisionSeq: 0, defaults, callsPerTurn: 4, tools: [{ ...tool, ...off }] });
  await expect(run("visitor_tool_save", {})).resolves.toEqual({ available: false, code: "VISITOR_TOOLS_T4_REQUIRED" });
  await expect(run("visitor_tool_delete", { toolId: "lookup" })).resolves.toEqual({ available: false, code: "VISITOR_TOOLS_T4_REQUIRED" });
  await expect(run("visitor_tools_list", { principalId: "someone-else" })).rejects.toThrow(new ToolInputError({ message: "Unexpected input key." }));
  await expect(run("visitor_tool_delete", { toolId: " " })).rejects.toThrow(new ToolInputError({ message: "Supply a created toolId. Deletion is deferred to T4." }));
  f.deny();
  await expect(run("visitor_tool_delete", { toolId: "lookup" })).rejects.toThrow(new ForbiddenError("visitor.manage is required."));
  await expect(toolsFixture(f, { composed: false }).run("visitor_tools_list", {})).rejects.toThrow(
    new ToolInputError({ message: "Visitor-tools management is unavailable in this server." }));
});

it("policy capacity reclaims unavailable Off entries but refuses to silently drop a live choice", async () => {
  const retired = Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`gone${i}`, off] as const));
  const reclaim = fixture({ initial: { version: 1, tools: retired } });
  const proposed = await reclaim.management.prepare(buildInput({ mode: "off" }));
  expect(proposed.policy).toEqual({ version: 1, tools: { lookup: off } });
  const published = Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`gone${i}`, { ...off, mode: "ask" }] as const));
  const refuse = fixture({ initial: { version: 1, tools: published } });
  const error = await refuse.management.prepare(buildInput({ mode: "off" })).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(ValidationError);
  expect((error as Error).message).toBe(`Too many visitor tools. Turn unavailable entries Off first: ${Object.keys(published).join(", ")}.`);
  expect(await refuse.repo.listRevisions({ settingId: definition.settingId })).toEqual([]);
});

it("overlapping memory transactions report a visitor revision conflict and do not save a second policy", async () => {
  const f = fixture();
  const prepared = await f.management.prepare(buildInput());
  await f.repo.transaction(async () => {
    await expect(f.management.apply({ callerPrincipalId, prepared })).rejects.toThrow(
      new VisitorToolsRevisionConflictError("Visitor tools changed. List them again before retrying."));
    expect(await f.repo.listRevisions({ settingId: definition.settingId })).toEqual([]);
  });
  expect(await readVisitorToolsSnapshot(f.store)).toEqual({ revisionSeq: 0, policy: { version: 1, tools: {} } });
});

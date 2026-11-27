import assert from "node:assert/strict";
import { test } from "vitest";

import { humanConfirmedHandler, ToolInputError, ToolPermissionDeniedError, type AgentToolDefinition, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";
import { MERGE_TOOL_ID } from "../tool-handlers.js";
import type { TaxonomyMergePrepared, TaxonomyPackageToolDeps } from "../tool-handlers.types.js";
import { createTaxonomyAgentToolCatalog, taxonomyAgentToolCatalog } from "../agent-tools.js";
import { buildTaxonomyToolRegistrations, taxonomyDerivedRisk } from "../tool-registrations.js";
import { InMemoryContentLookup, InMemoryEntryTermRepo, InMemoryTaxonomyRepo, InMemoryTaxonomyRevisionRepo, InMemoryTermRepo } from "../repo.memory.js";

/**
 * @file The taxonomy agent-tool handlers against port fakes only: the host's gateway, human-confirm
 * wrapper, strict-keys guard, slug function and content-type policy are injected fakes here.
 */

const WORKSPACE_ID = "ws-1";
const NOW = "2026-07-29T00:00:00.000Z";
const TOOL_IDS = [
  "taxonomy_get_term", "taxonomy_list", "taxonomy_get_assigned_terms", "taxonomy_create_taxonomy", "taxonomy_create_term",
  "taxonomy_rename_term", "taxonomy_assign_terms", "taxonomy_unassign_terms", "taxonomy_plan_merge_term", "taxonomy_execute_merge_term",
];

/** The host extends the shared catalog with two read tools; the test supplies minimal entries for them. */
const READ_TOOLS: AgentToolDefinition[] = ["taxonomy_get_term", "taxonomy_get_assigned_terms"].map((name) => ({
  name,
  description: `${name} (test entry)`,
  sideEffects: "none",
  authorization: { permission: "admin.taxonomy.manage" },
  inputSchema: { type: "object", additionalProperties: true, properties: {} },
}));
const CATALOG: AgentToolDefinition[] = [...taxonomyAgentToolCatalog, ...READ_TOOLS];

type Confirmation = "confirm" | "decline";

function ctx(input: Record<string, unknown>): ToolExecutionContext {
  return { executionId: "e1", principal: { id: "p1" }, run: { id: "r1" }, input, signal: new AbortController().signal };
}

function makeFixture(options: { allow?: boolean; answer?: Confirmation } = {}) {
  const allow = options.allow ?? true;
  const calls: string[] = [];
  const asked: TaxonomyMergePrepared[] = [];
  const events: string[] = [];
  const entryTermRepo = new InMemoryEntryTermRepo();
  const termRepo = new InMemoryTermRepo();
  const contentLookup = new InMemoryContentLookup({}, { seed: [{ contentType: "post", contentId: "post-1", workspaceId: WORKSPACE_ID, kind: "post" }] });
  const policy = { taxonomiesFor: async () => null };
  let counter = 0;
  const authorize = async (params: { permission: string }) => (allow ? { allowed: true, reason: "matched" } : { allowed: false, reason: `no ${params.permission}` });
  const deps: TaxonomyPackageToolDeps = {
    authorize,
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => `id-${++counter}` },
    taxonomyRepo: new InMemoryTaxonomyRepo(),
    termRepo,
    entryTermRepo: Object.assign(entryTermRepo, {
      listForContent: async ({ contentType, contentId }: { contentType: string; contentId: string }) =>
        (JSON.parse(JSON.stringify(entryTermRepo)).rows as Array<{ contentType: string; contentId: string; termId: string }>).filter((row) => row.contentType === contentType && row.contentId === contentId),
    }),
    taxonomyRevisionRepo: new InMemoryTaxonomyRevisionRepo(),
    outbox: { enqueue: async (event: { name: string }) => void events.push(event.name) } as unknown as TaxonomyPackageToolDeps["outbox"],
    stampWatermark: () => undefined,
    contentTargetPorts: () => ({ contentLookup, contentTypeTaxonomyPolicy: policy }),
    collectionTermPolicy: () => policy,
    authorizeContentEdit: async ({ principalId, contentType }: { principalId: string; contentType: string }) => {
      const permission = contentType === "post" || contentType === "page" ? "content.write" : "admin.collections.manage";
      const result = await authorize({ permission });
      if (!result.allowed) throw new ToolPermissionDeniedError({ message: `principal '${principalId}' is not authorized for '${permission}' (${result.reason})`, permission, reason: result.reason });
    },
    mergeTermHooks: ({ fromTermId, intoTermId }) => hooksFor({ entryTermRepo, fromTermId, intoTermId, calls }),
    mergeGateway: fakeGateway({ calls }),
    mergeConfirmedHandler: fakeConfirmedHandler({ answer: options.answer ?? "confirm", asked }),
    refuseUnexpectedKeys: (input, allowed) => {
      const extra = Object.keys(input).find((key) => !allowed.includes(key));
      if (extra !== undefined) throw new ToolInputError({ message: `'${extra}' is not an input of this tool.` });
    },
    toSlug: ({ text }) => `slug:${text.toLowerCase()}`,
  };
  const tools = buildTaxonomyToolRegistrations({ deps, surfaces: { surfaceExchanges: {} as never }, catalog: CATALOG });
  const call = (id: string, input: Record<string, unknown>) => find(tools, id).handler(ctx(input));
  return { deps, tools, call, calls, events, asked, entryTermRepo, termRepo };
}

function fakeGateway({ calls }: { calls: string[] }): TaxonomyPackageToolDeps["mergeGateway"] {
  return {
    plan: async ({ hooks }) => { calls.push("plan"); const plan = await hooks.computePlan({}); return { domain: "taxonomy.merge", planId: "plan-1", planHash: plan.planHash, details: plan.details }; },
    confirm: async () => { calls.push("confirm"); return { confirmationToken: "tok-1" }; },
    execute: async ({ hooks }) => { calls.push("execute"); return hooks.executeMutation({ planHash: "h", details: {} as never }); },
  };
}

/** The kit's `humanConfirmedHandler` (the registration kit requires it for this tool) with the human's answer fixed. */
function fakeConfirmedHandler({ answer, asked }: { answer: Confirmation; asked: TaxonomyMergePrepared[] }): TaxonomyPackageToolDeps["mergeConfirmedHandler"] {
  return (_surfaces, spec) => humanConfirmedHandler({
    prepare: ({ ctx: context }) => spec.prepare({ ctx: context }),
    askHuman: async ({ prepared }) => {
      asked.push(prepared);
      return answer === "decline" ? { confirmed: false, result: { [spec.flag]: false, cancelled: true } } : { confirmed: true };
    },
    run: ({ ctx: context, prepared, confirmer }) => spec.run({ ctx: context, prepared, confirmer }),
  });
}

function find(tools: ToolRegistration[], id: string): ToolRegistration {
  const tool = tools.find((candidate) => candidate.descriptor.id === id);
  assert.ok(tool, `expected '${id}' to be wired`);
  return tool;
}

function hooksFor({ entryTermRepo, fromTermId, intoTermId, calls }: { entryTermRepo: InMemoryEntryTermRepo; fromTermId: string; intoTermId: string; calls: string[] }): GatedMutationHooks<{ fromTermId: string; intoTermId: string; overlapLossDisclosed: boolean; overlappingContentCount: number }, { mergedCount: number }> {
  return {
    domain: "taxonomy.merge",
    readPermission: "admin.taxonomy.manage",
    mutatePermission: "admin.taxonomy.manage",
    scopeId: WORKSPACE_ID,
    computePlan: async () => {
      const overlappingContentCount = await entryTermRepo.countOverlap({ fromTermId, intoTermId });
      return { planHash: `hash-${overlappingContentCount}`, details: { fromTermId, intoTermId, overlapLossDisclosed: overlappingContentCount > 0, overlappingContentCount } };
    },
    executeMutation: async () => { calls.push("mutate"); const { repointedCount } = await entryTermRepo.repointTerm({ fromTermId, intoTermId }); return { mergedCount: repointedCount }; },
    resolveActorClassIdentity: async ({ principalId }: { principalId: string }) => principalId,
  } as never;
}

async function seedTerms(fixture: ReturnType<typeof makeFixture>) {
  const { taxonomy } = (await fixture.call("taxonomy_create_taxonomy", { name: "Topic" })) as { taxonomy: { id: string } };
  const { term: from } = (await fixture.call("taxonomy_create_term", { taxonomyId: taxonomy.id, name: "Alpha" })) as { term: { id: string } };
  const { term: into } = (await fixture.call("taxonomy_create_term", { taxonomyId: taxonomy.id, name: "Beta" })) as { term: { id: string } };
  await fixture.call("taxonomy_assign_terms", { contentType: "post", contentId: "post-1", termIds: [from.id] });
  return { taxonomyId: taxonomy.id, fromTermId: from.id, intoTermId: into.id };
}

test("registers the ten tools in order and classifies risk from the handlers", () => {
  const { tools } = makeFixture();
  assert.deepEqual(tools.map((tool) => tool.descriptor.id), TOOL_IDS);
  assert.deepEqual([...taxonomyDerivedRisk.keys()].sort(), [...TOOL_IDS].sort());
  assert.equal(find(tools, "taxonomy_plan_merge_term").descriptor.readOnly, true);
  assert.equal(find(tools, "taxonomy_create_term").descriptor.readOnly, false);
});

test("a catalog without an entry for a wired tool is refused, in plain words", () => {
  assert.throws(
    () => buildTaxonomyToolRegistrations({ deps: makeFixture().deps, surfaces: { surfaceExchanges: {} as never }, catalog: taxonomyAgentToolCatalog }),
    /catalog has no entry named 'taxonomy_get_term'/,
  );
});

test("a principal without the permission is refused before any write", async () => {
  const fixture = makeFixture({ allow: false });
  await assert.rejects(() => fixture.call("taxonomy_list", {}), (error: Error) => error instanceof ToolPermissionDeniedError && /admin\.taxonomy\.manage/.test(error.message));
  await assert.rejects(() => fixture.call("taxonomy_get_term", { termId: "t1" }), (error: Error) => error instanceof ToolInputError && error.message.startsWith("TAXONOMY_FORBIDDEN: "));
  await assert.rejects(() => fixture.call("taxonomy_assign_terms", { contentType: "post", contentId: "post-1", termIds: ["t"] }), /content\.write/);
  assert.deepEqual(fixture.events, []);
});

test("writes return their views and enqueue their events in order; the slug comes from the injected function", async () => {
  const fixture = makeFixture();
  const { taxonomyId, fromTermId, intoTermId } = await seedTerms(fixture);
  assert.deepEqual(fixture.events, ["taxonomy.created", "taxonomy.term_created", "taxonomy.term_created", "taxonomy.terms_assigned"]);
  const renamed = (await fixture.call("taxonomy_rename_term", { termId: intoTermId, newName: "Beta2" })) as { term: { name: string; version: number } };
  assert.deepEqual([renamed.term.name, renamed.term.version], ["Beta2", 2]);
  assert.deepEqual(await fixture.call("taxonomy_get_assigned_terms", { contentType: "post", contentId: "post-1" }), {
    contentType: "post", contentId: "post-1", terms: [{ termId: fromTermId, name: "Alpha", slug: "slug:alpha", taxonomyId, taxonomyName: "Topic" }],
  });
  assert.deepEqual(await fixture.call("taxonomy_unassign_terms", { contentType: "post", contentId: "post-1", termIds: [fromTermId, intoTermId] }), {
    contentType: "post", contentId: "post-1", unassignedTermIds: [fromTermId], notAssignedTermIds: [intoTermId],
  });
});

test("assigning to a content type off the allow-list is refused with the exact words", async () => {
  const fixture = makeFixture();
  const { fromTermId } = await seedTerms(fixture);
  await assert.rejects(() => fixture.call("taxonomy_assign_terms", { contentType: "widget", contentId: "w", termIds: [fromTermId] }), (error: Error) =>
    error instanceof ToolInputError && error.message === "content type 'widget' does not support taxonomy assignments. Use post, page, or a live collection key.");
});

test("the merge plan goes through the injected gateway and discloses the overlap", async () => {
  const fixture = makeFixture();
  const { fromTermId, intoTermId } = await seedTerms(fixture);
  const plan = (await fixture.call("taxonomy_plan_merge_term", { fromTermId, intoTermId })) as { planId: string; details: { overlappingContentCount: number } };
  assert.equal(plan.planId, "plan-1");
  assert.equal(plan.details.overlappingContentCount, 0);
  assert.deepEqual(fixture.calls, ["plan"]);
});

test(`${MERGE_TOOL_ID}: confirmed -> plan, confirm, execute in order, then the assignments move`, async () => {
  const fixture = makeFixture({ answer: "confirm" });
  const { fromTermId, intoTermId } = await seedTerms(fixture);
  assert.deepEqual(await fixture.call(MERGE_TOOL_ID, { fromTermId, intoTermId }), { merged: true, mergedCount: 1 });
  assert.deepEqual(fixture.calls, ["plan", "confirm", "execute", "mutate"]);
  assert.equal(await fixture.entryTermRepo.countByTerm({ termId: fromTermId }), 0);
  assert.equal(await fixture.entryTermRepo.countByTerm({ termId: intoTermId }), 1);
  assert.deepEqual([fixture.asked[0]?.fromName, fixture.asked[0]?.intoName, fixture.asked[0]?.plan.details.overlappingContentCount], ["Alpha", "Beta", 0]);
});

test(`${MERGE_TOOL_ID}: declined -> no confirm, no execute, no repo write`, async () => {
  const fixture = makeFixture({ answer: "decline" });
  const { fromTermId, intoTermId } = await seedTerms(fixture);
  const before = JSON.stringify(fixture.entryTermRepo);
  assert.deepEqual(await fixture.call(MERGE_TOOL_ID, { fromTermId, intoTermId }), { merged: false, cancelled: true });
  assert.deepEqual(fixture.calls, ["plan"]);
  assert.equal(JSON.stringify(fixture.entryTermRepo), before);
});

test(`${MERGE_TOOL_ID}: a stray input key is refused by the injected guard before any plan`, async () => {
  const fixture = makeFixture();
  const { fromTermId, intoTermId } = await seedTerms(fixture);
  await assert.rejects(() => fixture.call(MERGE_TOOL_ID, { fromTermId, intoTermId, confirm: true }), /'confirm' is not an input of this tool/);
  assert.deepEqual(fixture.calls, []);
});

test("the full catalog covers every handler with the shared assignment/read schema", () => {
  const catalog = createTaxonomyAgentToolCatalog({ termListToolId: "content_read.taxonomy" });
  const tools = buildTaxonomyToolRegistrations({ deps: makeFixture().deps, surfaces: { surfaceExchanges: {} as never }, catalog });
  assert.deepEqual(tools.map(tool => tool.descriptor.id).sort(), catalog.map(tool => tool.name).sort());
  assert.deepEqual((tools.find(tool => tool.descriptor.id === "taxonomy_get_assigned_terms")!.descriptor.inputSchema as { properties: Record<string, unknown> }).properties.contentType,
    (tools.find(tool => tool.descriptor.id === "taxonomy_assign_terms")!.descriptor.inputSchema as { properties: Record<string, unknown> }).properties.contentType);
});

test("taxonomy reads return the addressed term and its group without writing", async () => {
  const f = makeFixture();
  const { taxonomyId, fromTermId, intoTermId } = await seedTerms(f);
  const writes = [...f.events];
  const selected = await f.call("taxonomy_get_term", { termId: intoTermId });
  assert.deepEqual(selected, { term: { id: intoTermId, taxonomyId, parentId: null, name: "Beta", status: "active", updatedAt: NOW, version: 1 } });
  const list = await f.call("taxonomy_list", {}) as { items: Array<{ taxonomy: { id: string; name: string }; terms: Array<{ id: string; name: string }> }> };
  assert.deepEqual(list.items.map(({ taxonomy, terms }) => [taxonomy.id, taxonomy.name, terms.map(({ id, name }) => [id, name])]),
    [[taxonomyId, "Topic", [[fromTermId, "Alpha"], [intoTermId, "Beta"]]]]);
  assert.deepEqual(f.events, writes);
});

test("assignment and unassignment both reject an invalid middle term before changing the current set", async () => {
  const f = makeFixture();
  const { fromTermId, intoTermId } = await seedTerms(f);
  const writes = [...f.events];
  for (const id of ["taxonomy_assign_terms", "taxonomy_unassign_terms"]) {
    await assert.rejects(f.call(id, { contentType: "post", contentId: "post-1", termIds: [fromTermId, 12, intoTermId] }),
      (error: unknown) => error instanceof ToolInputError && error.message === "'termIds' (string array) is required");
  }
  assert.deepEqual((await f.deps.entryTermRepo.listForContent({ contentType: "post", contentId: "post-1" })).map(row => row.termId), [fromTermId]);
  assert.deepEqual(f.events, writes);
});

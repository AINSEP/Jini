import assert from "node:assert/strict";
import { test } from "vitest";

import { NEUTRAL_HOST_READ_VOCABULARY, type ToolExecutionContext, type ToolMetadataById } from "@jini-ai/core";
import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";
import { ensureSettingDefinitions, getEffective, InMemorySettingsRepo, set } from "@jini-ai/core/settings";

import { InMemoryEventBus, InMemoryOutbox } from "../../../redirects/__tests__/support/events.fixture.js";
import { seoDerivedRisk } from "../../tool-registrations.js";
import { ensureSeoSettingDefinitions } from "../settings.js";
import { buildSeoRegistrations, contributeSeoTools, type SeoToolDeps, type SeoToolHostPolicy } from "../tool-registrations.js";

/**
 * @file Characterization of SEO's host tool binding, written when it moved from the host: the
 * contributor names the `seo` domain and the package risk map, the host's metadata is applied to the
 * package registrations, and the settings tools read through the injected settings-ledger reader.
 * The host's tool-contract golden test pins the full catalog against its real composition.
 */

const WORKSPACE = "ws-seo-tools";
const clock = { nowIso: () => "2026-11-23T00:00:00.000Z" };
// Unique per call: the in-memory ledger keys definitions by id, so a constant id would leave only the last one registered.
let idSeq = 0;
const ids = { newId: () => `seo-tool-id-${++idSeq}` };
const principalRepo = {} as PrincipalRepoPort;
const createPrincipalLookup = () => ({ findActiveById: async ({ id }: { id: string }) => ({ id }) });
const toolMetadata = { seo_get_settings: { search: { keywords: "host seo settings words", queries: [] } } } as unknown as ToolMetadataById;

async function makeRouteDeps(): Promise<SeoToolDeps> {
  const settingsRepo = new InMemorySettingsRepo();
  await ensureSeoSettingDefinitions(
    { settingsRepo, clock, ids, principals: principalRepo, ensureSettingDefinitions, createPrincipalLookup },
    { workspaceId: WORKSPACE, systemPrincipalId: "system-seo" },
  );
  return {
    workspaceId: WORKSPACE, seoReady: Promise.resolve(), authorize: async () => ({ allowed: true, reason: "test" }),
    clock, idGen: ids, settingsRepo, principalRepo,
    // Read when the registrations are built; no assertion here exercises sitemap invalidation.
    seoDeps: { dispatch: async () => {} },
    sitemapService: { requestSitemapInvalidation: async () => {} },
  } as unknown as SeoToolDeps;
}

function policy(reads: string[]): SeoToolHostPolicy {
  return {
    toolMetadata,
    hostReads: NEUTRAL_HOST_READ_VOCABULARY,
    settingsLedger: {
      getEffective: (async (args) => { reads.push(args.key); return getEffective(args); }) as typeof getEffective,
      set,
      createPrincipalLookup,
    },
  };
}

test("the contributor names the seo domain and the package risk map", () => {
  const contributor = contributeSeoTools(policy([]), {});
  assert.equal(contributor.domain, "seo");
  assert.equal(contributor.risk, seoDerivedRisk);
});

test("the host metadata is applied and seo_get_settings reads through the injected reader", async () => {
  const reads: string[] = [];
  const deps = await makeRouteDeps();
  const registrations = buildSeoRegistrations({ deps, ...policy(reads) }, {});
  const tool = registrations.find((item) => item.descriptor.id === "seo_get_settings");
  assert.ok(tool);
  assert.match(JSON.stringify(tool.descriptor), /host seo settings words/);
  const context = { executionId: "exec", principal: { id: "editor" }, run: { id: "run" }, input: {}, signal: new AbortController().signal } as unknown as ToolExecutionContext;
  const result = await tool.handler(context) as { settings: { titleTemplate: string; sitemapEnabled: boolean } };
  assert.equal(result.settings.titleTemplate, "%s");
  assert.equal(result.settings.sitemapEnabled, true);
  assert.equal(reads.length, 8);
});

test("the contributor’s settings writer uses the host ledger and requests workspace sitemap invalidation", async () => {
  const base = await makeRouteDeps();
  const invalidations: Parameters<SeoToolDeps["sitemapService"]["requestSitemapInvalidation"]>[0][] = [];
  const deps: SeoToolDeps = {
    ...base,
    outbox: new InMemoryOutbox(),
    bus: new InMemoryEventBus(),
    sitemapService: { ...base.sitemapService, requestSitemapInvalidation: async (request) => { invalidations.push(request); } },
  };
  const writes: Parameters<typeof set>[0]["input"][] = [];
  const hostPolicy = policy([]);
  const registrations = contributeSeoTools({
    ...hostPolicy,
    settingsLedger: { ...hostPolicy.settingsLedger, set: (args) => { writes.push(args.input); return set(args); } },
  }).build(deps, undefined);
  const write = registrations.find((item) => item.descriptor.id === "seo_set_settings");
  const read = registrations.find((item) => item.descriptor.id === "seo_get_settings");
  assert.ok(write && read);
  const context: ToolExecutionContext = {
    executionId: "exec", principal: { id: "editor" }, run: { id: "run" },
    input: { sitemapEnabled: false }, signal: new AbortController().signal,
  };
  await write.handler(context);
  assert.deepEqual(writes, [{
    namespace: "site.seo", key: "sitemap_enabled", scope: "workspace", value: false,
    workspaceId: WORKSPACE, authWorkspaceId: WORKSPACE, callerPrincipalId: "editor", requiredPermissionOverride: "admin.seo.manage",
  }]);
  const result = await read.handler({ ...context, input: {} }) as { settings: { sitemapEnabled: boolean } };
  assert.equal(result.settings.sitemapEnabled, false);
  assert.equal(invalidations.length, 1);
  const invalidation = invalidations[0]!;
  assert.deepEqual(invalidation.input, { workspaceId: WORKSPACE });
  assert.equal(invalidation.deps.outbox, deps.outbox);
  assert.equal(invalidation.deps.bus, deps.bus);
  assert.equal(invalidation.deps.clock, deps.clock);
  assert.equal(invalidation.deps.idGen, deps.idGen);
  assert.equal(invalidation.deps.dispatch, deps.seoDeps.dispatch);
});

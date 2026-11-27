import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { describe, expect, it } from "vitest";

import { SeoSettingsValidationError } from "../errors.js";
import { buildSeoToolRegistrations, seoDerivedRisk, type SeoPackageToolDeps, type SeoSettingsPort } from "../tool-registrations.js";
import { InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError } from "@jini-ai/core/contracts/server/verified-origin";
import { InMemorySettingsRepo, seoDeps } from "./support/legacy-api.fixture.js";
import { buildPostRecord, InMemoryPostRepo } from "./support/post.fixture.js";
import type { SeoSettings } from "../types.js";

const SETTINGS: SeoSettings = { titleTemplate: "%s", defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: true, robotsRules: [] };

function makeDeps(overrides: Partial<SeoPackageToolDeps> = {}) {
  const calls = {
    authorize: [] as string[], settingsSet: [] as unknown[], regenerated: [] as unknown[], invalidations: [] as unknown[], dispatched: 0,
  };
  const seoSettings: SeoSettingsPort = {
    get: async () => SETTINGS,
    set: async (input) => { calls.settingsSet.push(input); return { ...SETTINGS, ...input.patch }; },
  };
  const outbox = { name: "outbox" };
  const bus = { name: "bus" };
  const deps: SeoPackageToolDeps = {
    outbox: outbox as never,
    bus: bus as never,
    authorize: async (params) => { calls.authorize.push(String((params as { permission?: unknown }).permission)); return { allowed: true, reason: "matched" }; },
    workspaceId: "ws-1",
    clock: { nowIso: () => "2026-11-18T00:00:00.000Z" },
    idGen: { newId: () => "id-1" },
    seoReady: Promise.resolve(),
    seoDeps: { dispatch: async () => { calls.dispatched += 1; } } as never,
    sitemapService: {
      regenerateSitemapCache: async (input: unknown) => { calls.regenerated.push(input); },
      requestSitemapInvalidation: async (required: { deps: unknown; input: unknown }) => { calls.invalidations.push(required); },
    } as never,
    seoSettings,
    ...overrides,
  };
  return { calls, deps, outbox, bus, registrations: buildSeoToolRegistrations({ deps }) };
}

function run(registrations: ToolRegistration[], id: string, input: unknown, signal = new AbortController().signal): Promise<unknown> {
  const tool = registrations.find((registration) => registration.descriptor.id === id);
  if (!tool) throw new Error(`${id} is not wired`);
  const ctx: ToolExecutionContext = { executionId: "e1", principal: { id: "p1" }, run: { id: "r1" }, input, signal };
  return Promise.resolve(tool.handler(ctx, {}));
}

describe("buildSeoToolRegistrations", () => {
  it("registers the six seo tools in catalog order, with no host metadata", () => {
    const { registrations } = makeDeps();
    expect(registrations.map((registration) => registration.descriptor.id)).toEqual([
      "seo_get_entry_meta", "seo_analyze_entry", "seo_set_entry_overrides", "seo_get_settings", "seo_set_settings", "seo_regenerate_sitemap",
    ]);
    expect(registrations.every((registration) => registration.descriptor.metadata === undefined)).toBe(true);
    expect(seoDerivedRisk.size).toBe(6);
  });

  it("reads the settings through the port after the manage permission check", async () => {
    const { registrations, calls } = makeDeps();
    expect(await run(registrations, "seo_get_settings", {})).toEqual({ settings: SETTINGS });
    expect(calls.authorize).toEqual(["admin.seo.manage"]);
  });

  it("gates seo_set_settings on the permission before it reaches the settings port", async () => {
    const denied = makeDeps({ authorize: async () => ({ allowed: false, reason: "insufficient_permission" }) });
    await expect(run(denied.registrations, "seo_set_settings", { twitterSite: "@example" })).rejects.toThrow("admin.seo.manage");
    expect(denied.calls.settingsSet).toEqual([]);
    const allowed = makeDeps();
    expect(await run(allowed.registrations, "seo_set_settings", { twitterSite: "@example" })).toEqual({ settings: { ...SETTINGS, twitterSite: "@example" } });
    expect(allowed.calls.settingsSet).toEqual([{ workspaceId: "ws-1", patch: { twitterSite: "@example" }, callerPrincipalId: "p1" }]);
  });

  it("answers a settings validation refusal with the published schema, as an input error", async () => {
    const { registrations } = makeDeps({ seoSettings: { get: async () => SETTINGS, set: async () => { throw new SeoSettingsValidationError("'x' is not a registered SEO setting field."); } } });
    const failure = await run(registrations, "seo_set_settings", { x: 1 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolInputError);
    expect((failure as Error).message).toContain("Schema for 'seo_set_settings'");
  });

  it("requires the read version to write entry overrides, naming the read the host's vocabulary gives", async () => {
    const { deps } = makeDeps();
    const registrations = buildSeoToolRegistrations({ deps }, { hostReads: { readRef: ({ entity }) => `host_read.${entity}` } });
    await expect(run(registrations, "seo_set_entry_overrides", { entryId: "post-1", title: "T" })).rejects.toThrow("host_read.seo_entry_meta");
    expect(JSON.stringify(registrations.map((r) => r.descriptor))).not.toContain("{{read:");
  });

  it("names the read neutrally, never a tool id, when the host binds no vocabulary", async () => {
    const { registrations } = makeDeps();
    const failure = await run(registrations, "seo_set_entry_overrides", { entryId: "post-1", title: "T" }).catch((error: unknown) => error);
    expect((failure as Error).message).toContain("the seo entry meta read tool");
    expect((failure as Error).message).not.toContain("content_read");
  });

  it("regenerates the sitemap cache and then requests invalidation with the outbox, bus, clock and dispatcher", async () => {
    const { registrations, calls, outbox, bus } = makeDeps();
    expect(await run(registrations, "seo_regenerate_sitemap", {})).toEqual({ accepted: true });
    expect(calls.regenerated).toEqual([{ workspaceId: "ws-1" }]);
    expect(calls.invalidations).toHaveLength(1);
    const { deps, input } = calls.invalidations[0] as { deps: Record<string, unknown>; input: unknown };
    expect(input).toEqual({ workspaceId: "ws-1" });
    expect(deps.outbox).toBe(outbox);
    expect(deps.bus).toBe(bus);
    expect(typeof deps.dispatch).toBe("function");
  });
});

function entryFixture() {
  const row = buildPostRecord({
    id: "dispatch", workspaceId: "ws-1", slug: "dispatch", title: "Monthly dispatch",
    version: 4, seoExtJson: '{"title":"Old override","nofollow":true}',
    bodyJson: { type: "doc", content: [] },
  });
  const repo = new InMemoryPostRepo([row]);
  const reads = seoDeps({
    postRepo: repo, settingsRepo: new InMemorySettingsRepo(),
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: {
      canonicalOrigin: async () => { throw new OriginNotVerifiedError({ message: "No verified origin" }); },
      isAllowedRedirectTarget: async () => false,
      isAllowedEgressTarget: async () => false,
    },
  });
  const requests: unknown[] = [];
  const allowed = { workspaceId: "ws-1", principalId: "p1", permission: "admin.seo.manage", entityType: "seo-entry", entityId: "dispatch" };
  const setup = makeDeps({
    authorize: async (request) => {
      requests.push(request);
      return {
        allowed: Object.entries(allowed).every(([key, value]) => request[key as keyof typeof request] === value),
        reason: "entry-specific grant",
      };
    },
    seoDeps: {
      ...reads,
      renderBaseUrl: "https://news.example/",
      postRepo: {
        ...reads.postRepo, saveIfVersion: input => repo.saveIfVersion(input),
        appendRevision: input => repo.appendRevision(input), transaction: ({ fn }) => repo.transaction(fn),
      },
      dispatch: async () => {},
    },
  });
  return { ...setup, row, repo, requests, allowed };
}

it("reads resolved metadata and its version under the entry-specific grant", async () => {
  const { registrations, requests, allowed } = entryFixture();
  expect(await run(registrations, "seo_get_entry_meta", { entryId: "dispatch" })).toMatchObject({
    meta: { title: "Old override", version: 4, canonical: "https://news.example/dispatch" },
  });
  expect(requests).toEqual([allowed]);
});

it("returns analysis for the selected entry with a missing-description warning", async () => {
  const { registrations, requests, allowed } = entryFixture();
  expect(await run(registrations, "seo_analyze_entry", { entryId: "dispatch" })).toMatchObject({
    analysis: { entryId: "dispatch", score: 80, issues: [
      { code: "missing_description", severity: "warning", message: "Description is missing.", field: "description" },
    ], resolved: { title: "Old override", version: 4 } },
  });
  expect(requests).toEqual([allowed]);
});

it("passes a null clear and the version basis to the override writer, not as SEO fields", async () => {
  const { registrations, repo, requests, allowed, calls } = entryFixture();
  expect(await run(registrations, "seo_set_entry_overrides", {
    entryId: "dispatch", expectedVersion: 4, title: null, canonical: "https://news.example/current",
  })).toEqual({ overrides: { nofollow: true, canonical: "https://news.example/current" } });
  expect(await repo.findById({ workspaceId: "ws-1", id: "dispatch" })).toMatchObject({
    version: 5, seoExtJson: '{"nofollow":true,"canonical":"https://news.example/current"}',
  });
  expect(requests).toEqual([allowed]);
  expect(calls.invalidations.map((request) => (request as { input: unknown }).input)).toEqual([{ workspaceId: "ws-1" }]);
});

it.each([
  { field: "typo", value: "on", message: "'typo' is not a registered SEO field" },
  { field: "canonical", value: "file:///document", message: "'canonical' uses an unsafe URL scheme" },
])("returns input guidance for a refused override field $field", async ({ field, value, message }) => {
  const { registrations, repo, row, calls } = entryFixture();
  const failure = await run(registrations, "seo_set_entry_overrides", {
    entryId: "dispatch", expectedVersion: 4, [field]: value,
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ToolInputError);
  expect((failure as Error).message).toContain(message);
  expect((failure as Error).message).toContain("Schema for 'seo_set_entry_overrides'");
  expect(await repo.findById({ workspaceId: "ws-1", id: "dispatch" })).toEqual(row);
  expect(calls.invalidations).toEqual([]);
});

it("does not authorize or persist a cancelled override write", async () => {
  const { registrations, repo, requests, row } = entryFixture();
  const cancellation = new Error("Editor cancelled");
  const controller = new AbortController();
  controller.abort(cancellation);
  await expect(run(registrations, "seo_set_entry_overrides", {
    entryId: "dispatch", expectedVersion: 4, title: "Cancelled",
  }, controller.signal)).rejects.toBe(cancellation);
  expect(requests).toEqual([]);
  expect(await repo.findById({ workspaceId: "ws-1", id: "dispatch" })).toEqual(row);
});

it("a stale override write names the configured read tool and preserves the newer saved SEO", async () => {
  const { deps, row, repo, calls } = entryFixture();
  const registrations = buildSeoToolRegistrations({ deps }, { hostReads: { readRef: ({ entity }) => `host_read.${entity}` } });
  const failure = await run(registrations, "seo_set_entry_overrides", {
    entryId: "dispatch", expectedVersion: 3, title: "Stale title",
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ToolInputError);
  expect((failure as Error).message).toContain("VERSION_CONFLICT");
  expect((failure as Error).message).toContain("Call host_read.seo_entry_meta again");
  expect(await repo.findById({ workspaceId: "ws-1", id: "dispatch" })).toEqual(row);
  expect(calls.invalidations).toEqual([]);
});

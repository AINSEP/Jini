import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { describe, expect, it } from "vitest";

import { SeoSettingsValidationError } from "../errors.js";
import { buildSeoToolRegistrations, seoDerivedRisk, type SeoPackageToolDeps, type SeoSettingsPort } from "../tool-registrations.js";
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

function run(registrations: ToolRegistration[], id: string, input: unknown): Promise<unknown> {
  const tool = registrations.find((registration) => registration.descriptor.id === id);
  if (!tool) throw new Error(`${id} is not wired`);
  const ctx: ToolExecutionContext = { executionId: "e1", principal: { id: "p1" }, run: { id: "r1" }, input, signal: new AbortController().signal };
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

  it("requires the read version to write entry overrides", async () => {
    const { registrations } = makeDeps();
    await expect(run(registrations, "seo_set_entry_overrides", { entryId: "post-1", title: "T" })).rejects.toThrow("content_read.seo_entry_meta");
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

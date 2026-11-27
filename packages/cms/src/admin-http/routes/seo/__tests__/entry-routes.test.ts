import { describe, expect, it, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";

import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import {
  SeoConcurrentWriteError, SeoEntryNotFoundError, SeoFieldValidationError, SeoInvalidCanonicalUrlError,
} from "../../../../seo/errors.js";
import { seoGetEntryRoute } from "../get-entry.js";
import { seoGetEntryAnalyzeRoute } from "../get-entry-analyze.js";
import { InMemoryPostRepo, buildPostRecord } from "../../../../seo/__tests__/support/post.fixture.js";
import { InMemoryTransformDefinitionRepo } from "../../../../media/repo.memory.js";
import type { SeoPostWritePort } from "../../../../seo/ports.js";
import type { GetEntryMetaDeps } from "../../../../seo/seo.js";
import { seoPutEntryRoute } from "../put-entry.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file The by-entry SEO specs: meta read, analysis read and the override write, over a scripted post repo. */

const ready = Promise.resolve();

/** Read deps whose post lookup throws `error` (or finds nothing), counting each lookup. */
function seoDeps({ error }: { error?: unknown } = {}) {
  const lookups: unknown[] = [];
  const postRepo = {
    findById: async (input: unknown) => { lookups.push(input); if (error) throw error; return null; },
    extractPlainText: () => "", isTrashed: async () => false,
  };
  return { lookups, deps: { postRepo, settings: {}, media: {} } as never };
}

/** A host formatter whose output is distinct from the error text, so a route that skipped it would show. */
const hostWording = ({ error }: { error: Error }) => `host: ${error.message}`;

describe("seo entry read specs", () => {
  for (const [route, path] of [
    [seoGetEntryRoute, "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId"],
    [seoGetEntryAnalyzeRoute, "/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId/analyze"],
  ] as const) {
    it(`${path}: keeps the GET path, no body cap, and reads :entryId with a "" fallback`, () => {
      expect(route.method).toBe("get");
      expect(route.path).toBe(path);
      expect(route.maxBodyBytes).toBeUndefined();
      expect(route.parse(raw({ entryId: "e1" }))).toEqual({ ok: true, value: { entryId: "e1" } });
      expect(route.parse(raw({}))).toEqual({ ok: true, value: { entryId: "" } });
    });

    it(`${path}: authorizes admin.seo.manage on that seo-entry, then answers a missing entry 404 SEO_ENTRY_NOT_FOUND`, async () => {
      const { authorize, calls } = recordingAuthorize();
      const read = seoDeps();
      expect(await refusalOf(() => route.handle({ input: { entryId: "e1" }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, outwardErrorMessage: hostWording, seoDeps: read.deps }, context: PRINCIPAL, authorize }))).toEqual({
        status: 404, body: { error: "host: entry 'e1' was not found", code: "SEO_ENTRY_NOT_FOUND" },
      });
      expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-entry", entityId: "e1" }]);
      expect(read.lookups.length).toBeGreaterThan(0);
    });

    it(`${path}: reads nothing when authorization refuses, rethrows an unmapped failure, fails closed unwired`, async () => {
      const denied = seoDeps();
      await expect(route.handle({ input: { entryId: "e1" }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, outwardErrorMessage: hostWording, seoDeps: denied.deps }, context: PRINCIPAL, authorize: recordingAuthorize(["admin.seo.manage"]).authorize })).rejects.toThrow("denied");
      expect(denied.lookups).toEqual([]);
      const broken = seoDeps({ error: new Error("private storage details") });
      await expect(route.handle({ input: { entryId: "e1" }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, outwardErrorMessage: hostWording, seoDeps: broken.deps }, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("private storage details");
      await expect(route.handle({ input: { entryId: "e1" }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, outwardErrorMessage: hostWording, seoDeps: broken.deps }, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    });
  }
});

describe("seoPutEntryRoute", () => {
  const putDeps = (error?: unknown) => {
    const read = seoDeps({ error });
    return { read, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, seoDeps: read.deps, outwardErrorMessage: ({ error }: { error: Error }) => error.message, entryAuthorize: async () => ({ allowed: true }), invalidateSitemapCache: () => {}, clock: { nowMs: () => 0 } } as never };
  };

  it("keeps the PUT path, no body cap, and splits expectedVersion off the patch", () => {
    expect(seoPutEntryRoute.method).toBe("put");
    expect(seoPutEntryRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId");
    expect(seoPutEntryRoute.maxBodyBytes).toBeUndefined();
    expect(seoPutEntryRoute.parse(raw({ entryId: "e1" }, { title: "T", expectedVersion: 3 }))).toEqual({ ok: true, value: { entryId: "e1", rawExpectedVersion: 3, patch: { title: "T" } } });
    expect(seoPutEntryRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { entryId: "", rawExpectedVersion: undefined, patch: {} } });
  });

  it("authorizes admin.seo.manage on that seo-entry before validating expectedVersion (400 VALIDATION_ERROR)", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { deps, read } = putDeps();
    expect(await refusalOf(() => seoPutEntryRoute.handle({ input: { entryId: "e1", rawExpectedVersion: "x", patch: {} }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" },
    });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-entry", entityId: "e1" }]);
    expect(read.lookups).toEqual([]);
  });

  const conflict = new RecordVersionConflictError({ recordKind: "post", recordId: "e1", expectedVersion: 1, currentVersion: 2 } as never);
  const ladder: Array<[string, unknown, { status: number; body: unknown }]> = [
    ["trashed entry (before the generic 400)", new EntityNotLiveError({ entityType: "post", entityId: "e1", state: "trashed" } as never), { status: 409, body: {} }],
    ["tool input", new ToolInputError({ message: "bad patch" }), { status: 400, body: { error: "bad patch", code: "VALIDATION_ERROR" } }],
    ["version conflict", conflict, { status: 409, body: { error: conflict.message, code: "VERSION_CONFLICT", details: { recordKind: conflict.recordKind, recordId: conflict.recordId, expectedVersion: conflict.expectedVersion, currentVersion: conflict.currentVersion } } }],
    ["field validation", new SeoFieldValidationError("title too long"), { status: 400, body: { error: "title too long", code: "SEO_FIELD_VALIDATION_ERROR" } }],
    ["canonical url", new SeoInvalidCanonicalUrlError("bad url"), { status: 400, body: { error: "bad url", code: "SEO_INVALID_CANONICAL_URL" } }],
    ["missing entry", new SeoEntryNotFoundError("entry 'e1' was not found"), { status: 404, body: { error: "entry 'e1' was not found", code: "SEO_ENTRY_NOT_FOUND" } }],
    ["lost the row three times", new SeoConcurrentWriteError("gave up"), { status: 409, body: { error: "gave up", code: "SEO_CONCURRENT_WRITE" } }],
  ];
  for (const [name, error, expected] of ladder) {
    it(`maps ${name} to its exact status and body`, async () => {
      const { deps } = putDeps(error);
      const refusal = await refusalOf(() => seoPutEntryRoute.handle({ input: { entryId: "e1", rawExpectedVersion: undefined, patch: { title: "T" } }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }));
      if (error instanceof EntityNotLiveError) {
        expect(refusal).toEqual({ status: 409, body: { error: error.message, code: error.code } });
      } else {
        expect(refusal).toEqual(expected);
      }
    });
  }

  it("rethrows an unmapped failure unchanged, and fails closed without a principal", async () => {
    const { deps } = putDeps(new Error("private storage details"));
    await expect(seoPutEntryRoute.handle({ input: { entryId: "e1", rawExpectedVersion: undefined, patch: {} }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("private storage details");
    await expect(seoPutEntryRoute.handle({ input: { entryId: "e1", rawExpectedVersion: undefined, patch: {} }, deps, context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});

function liveEntryFixture() {
  const postRepo = new InMemoryPostRepo([buildPostRecord({
    workspaceId: WORKSPACE_ID, id: "post-garden", title: "Herb garden", slug: "herb-garden", version: 6,
  })]);
  const lookupSettings = vi.fn<GetEntryMetaDeps["settings"]["getSeoSettings"]>().mockResolvedValue({
    titleTemplate: "%s | Field Notes", defaultRobots: { noindex: false, nofollow: true }, sitemapEnabled: true, robotsRules: [],
  });
  const seoDeps: GetEntryMetaDeps & { postRepo: SeoPostWritePort } = {
    postRepo,
    settings: { getSeoSettings: lookupSettings, isDefaultRobotsNoindexExplicitlySet: async () => false },
    media: {
      featuredImage: {
        findMediaByIdOrSlug: async () => null,
        mediaUrlKey: ({ asset }) => asset.slug,
        mediaPublicPath: ({ key }) => `/m/${key}`,
        resolveFeaturedImageRef: async () => ({ ok: false, reason: "no media" }),
      },
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}),
    },
    originRegistry: {
      canonicalOrigin: async () => ({ scheme: "https", host: "garden.example.test", verifiedAt: "2026-11-20T00:00:00Z", source: "workspace-setting" }),
      isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false,
    },
    runtimeMode: "production",
    urls: { postPublicPath: ({ slug }) => `/posts/${slug}`, urlFor: async () => null },
    liveness: { isScheduledAt: () => false, isLiveAt: () => true, postDisplayDateIso: () => "2026-11-20T00:00:00Z" },
    clock: { nowIso: () => "2026-11-20T00:00:00Z" },
  };
  return { postRepo, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, outwardErrorMessage: hostWording, seoDeps }, lookupSettings };
}

it("returns a live entry's resolved SEO metadata in the data envelope", async () => {
  const { deps, lookupSettings } = liveEntryFixture();
  const { authorize, calls } = recordingAuthorize();
  expect(await seoGetEntryRoute.handle({ input: { entryId: "post-garden" }, deps, context: PRINCIPAL, authorize }))
    .toMatchObject({ ok: true, value: { data: {
      title: "Herb garden | Field Notes", canonical: "https://garden.example.test/posts/herb-garden",
      robots: { noindex: false, nofollow: true },
    } } });
  expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-entry", entityId: "post-garden" }]);
  expect(lookupSettings.mock.calls).toEqual([[{ workspaceId: WORKSPACE_ID }]]);
});

it("returns the live entry's SEO score and actionable description warning", async () => {
  const { deps } = liveEntryFixture();
  expect(await seoGetEntryAnalyzeRoute.handle({ input: { entryId: "post-garden" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))
    .toMatchObject({ ok: true, value: { data: {
      entryId: "post-garden", score: 80, resolved: { title: "Herb garden | Field Notes" },
      issues: [{ code: "missing_description", field: "description", severity: "warning", message: "Description is missing." }],
    } } });
});

it("persists an SEO override against a matching version and returns its newly resolved metadata", async () => {
  const { deps, postRepo } = liveEntryFixture();
  const entryAuthorize = vi.fn(async () => ({ allowed: true, reason: "SEO editor" }));
  const invalidateSitemapCache = vi.fn();
  const run = (expectedVersion: number, title: string) => seoPutEntryRoute.handle({
    input: { entryId: "post-garden", rawExpectedVersion: expectedVersion, patch: { title } },
    deps: { ...deps, entryAuthorize, invalidateSitemapCache, clock: { nowMs: () => Date.parse("2026-11-20T00:00:00Z") } },
    context: PRINCIPAL, authorize: recordingAuthorize().authorize,
  });
  const readBack = () => postRepo.findById({ workspaceId: WORKSPACE_ID, id: "post-garden" });
  expect(await run(6, "Kitchen herb guide")).toMatchObject({ ok: true, value: { data: {
    title: "Kitchen herb guide", openGraph: { title: "Kitchen herb guide" },
  } } });
  expect(await readBack()).toMatchObject({ version: 7, title: "Herb garden", seoExtJson: '{"title":"Kitchen herb guide"}' });
  expect(entryAuthorize.mock.calls).toEqual([[{
    principalId: "principal-1", workspaceId: "ws-1", entityId: "post-garden", entityType: "seo-entry", permission: "admin.seo.manage",
  }]]);
  expect(invalidateSitemapCache).not.toHaveBeenCalled();

  expect(await refusalOf(() => run(6, "Stale editor title"))).toMatchObject({
    status: 409, body: { code: "VERSION_CONFLICT", details: { recordId: "post-garden", expectedVersion: 6, currentVersion: 7 } },
  });
  expect(await readBack()).toMatchObject({ version: 7, seoExtJson: '{"title":"Kitchen herb guide"}' });
});

import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/core/contracts/server/verified-origin";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../../../media/index.js";
import { InMemorySettingsRepo, seoDeps } from "../../../../seo/__tests__/support/legacy-api.fixture.js";
import { buildPostRecord, InMemoryPostRepo, type PostRecord } from "../../../../seo/__tests__/support/post.fixture.js";
import type { SeoPutEntryRouteDeps } from "../put-entry.js";

/** @file Shared fakes for the SEO route-spec tests: the real SEO read/write services over in-memory repos. */

export const WORKSPACE_ID = "ws-1";
export const ENTRY_ID = "post-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One recorded authorization: the permission, the entity type and, for entry routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`, so each test pins the permission, entity type and entity id the route asks for. */
export function recordingAuthorize(): { authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[] } {
  const calls: RecordedAuthorize[] = [];
  return { calls, authorize: async ({ permission, entityType }, optional = {}) => { calls.push({ permission, entityType, ...optional }); } };
}

/** An `authorize` that refuses like the host port does (by throwing), so a test can prove nothing ran after it. */
export const denyingAuthorize = async (): Promise<void> => { throw new Error("denied"); };

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** A published entry titled "Hello", version 1. */
export function seedEntry(overrides: Partial<PostRecord> = {}): PostRecord {
  return buildPostRecord({ id: ENTRY_ID, workspaceId: WORKSPACE_ID, slug: "hello", title: "Hello", status: "published", version: 1, ...overrides });
}

/** The put-entry deps over one in-memory post repo; the entry routes read the same `seoDeps`. */
export function makeSeoRouteDeps(posts: PostRecord[] = [seedEntry()]): SeoPutEntryRouteDeps & { repo: InMemoryPostRepo; invalidations: string[] } {
  const repo = new InMemoryPostRepo(posts);
  const read = seoDeps({
    postRepo: repo,
    settingsRepo: new InMemorySettingsRepo(),
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [] }) }),
  });
  const postRepo = {
    ...read.postRepo,
    saveIfVersion: (input: { record: PostRecord; ifVersion: number }) => repo.saveIfVersion(input),
    transaction: <T>({ fn }: { fn: () => Promise<T> }) => repo.transaction(fn),
    appendRevision: (input: Parameters<InMemoryPostRepo["appendRevision"]>[0]) => repo.appendRevision(input),
  };
  const invalidations: string[] = [];
  return {
    repo, invalidations, workspaceId: WORKSPACE_ID, seoReady: Promise.resolve(),
    authorize: async () => ({ allowed: true, reason: "matched" }),
    clock: { nowMs: () => Date.parse("2026-09-18T00:00:00.000Z") },
    seoDeps: { ...read, postRepo } as SeoPutEntryRouteDeps["seoDeps"],
    sitemapService: { invalidateSitemapCache: ({ workspaceId }) => { invalidations.push(workspaceId); } },
  };
}

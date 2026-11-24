import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { InMemoryMediaRepo } from "../../../../media/index.js";
import type { MediaRecord } from "../../../../media/types.js";
import type { MediaAssetLookups } from "../shared.js";

/** @file Shared fakes for the media route-spec tests: a fixed asset row, a recording authorizer, the host lookups and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
export const NOW = "2026-10-08T01:00:00.000Z";

/** One stored image asset, so serialized DTOs can be pinned field by field. */
export function fakeMedia(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "a1", workspaceId: WORKSPACE_ID, kind: "media", title: "Hero", slug: "hero", alt: "", caption: "", credit: "",
    source: { sha256: "f".repeat(64) }, status: "active", createdAt: NOW, updatedAt: NOW, version: 3,
    width: null, height: null, cssClass: null, htmlAttributes: null, originalFilename: "hero.png", createdBy: "principal-0",
    ...overrides,
  } as MediaRecord;
}

/** Host lookups that answer fixed, recognizable values, so a response proves which one was used. */
export const LOOKUPS: MediaAssetLookups = {
  readContentType: async ({ sha256 }) => `image/test+${sha256.slice(0, 2)}`,
  resolvePublicUrl: async ({ media }) => `/m/${media.slug}/public`,
  resolveByteSize: async () => 1234,
};

/** The admin DTO {@link fakeMedia} serializes to under {@link LOOKUPS}. */
export function fakeMediaDto(overrides: Partial<MediaRecord> = {}): Record<string, unknown> {
  const media = fakeMedia(overrides);
  return {
    id: media.id, kind: "media", originalFilename: "hero.png", displayFilename: media.title, createdBy: "principal-0",
    workspaceId: WORKSPACE_ID, title: media.title, slug: media.slug, alt: media.alt, caption: media.caption, credit: media.credit,
    sha256: media.source.sha256, byteSize: 1234, status: media.status, createdAt: media.createdAt, updatedAt: media.updatedAt,
    version: media.version, width: media.width, height: media.height, cssClass: media.cssClass, htmlAttributes: media.htmlAttributes,
    contentType: "image/test+ff", publicUrl: `/m/${media.slug}/public`,
  };
}

/** A real in-memory media repo seeded with the given rows. */
export function mediaRepoWith(rows: MediaRecord[] = [fakeMedia()]): InMemoryMediaRepo {
  return new InMemoryMediaRepo({}, { initialRows: rows });
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
      calls.push({ permission, entityType, ...optional });
      if (denied.includes(permission)) throw new Error(`denied ${permission}`);
    },
  };
}

/** Run `fn` and return the refusal it throws (status + body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

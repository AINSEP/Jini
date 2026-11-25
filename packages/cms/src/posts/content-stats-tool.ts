import { toolMetadata } from '@jini-ai/core/tool-metadata/post';
import { adaptLegacyAuthorize } from "../core/index.js";
import { ToolInputError } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission } from "../core/index.js";
import type { ToolContributor } from "@jini-ai/core";
import { ForbiddenError } from "../core/index.js";
import { forbiddenRule } from "@jini-ai/core/model-facing-tool-errors";
import { withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { PostRecord, PostRepoPort } from "./post.js";
import { extractPostPlainText } from "./search.js";
import { extractPlainTextFromHtml } from "../seo/index.js";
import { sniffContentType } from "../media/index.js";
import type { MediaContentTypeStorePort } from "../media/site/content-type-store.js";

/** Read ports only; structural projections also permit small in-memory fixtures. */
export interface ContentStatsToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  postRepo: Pick<PostRepoPort, "list">;
  contentTypeRepo: { listByWorkspace(input: { workspaceId: string }): Promise<Array<{ key: string; status: string }>> };
  entryRepo: { listByWorkspace(input: { workspaceId: string }): Promise<Array<{ type: string; status: string }>> };
  mediaRepo: { list(input: { workspaceId: string }): Promise<Array<{ status: string; source: { sha256: string } }>> };
  mediaContentTypeStore: Pick<MediaContentTypeStorePort, "getMany">;
  assetBlobRepo: { list(input: { workspaceId: string }): Promise<Array<{ sha256: string; storageKey: string }>> };
  blobStore: { get(input: { storageKey: string }): Promise<Uint8Array> };
}

export const contentStatsAgentToolCatalog = [{
  name: "content_stats",
  description: "Counts posts, pages, collection entries and media by status, with word counts. Use for 'how many posts do I have', 'posts vs pages', 'how long are my articles', and before drawing a chart of the site's content. Does not list the items themselves — use the host's content read tool for that. Counts live content, excluding trash. Returns posts/pages totals and byStatus, optional words (total, average, longest), entries by contentType, and media totals (images, videos, other). Requires content.read; denied admin.collections.read or media.read sections are omitted and named in omitted. Word counts use the listing's plain text extraction, including its document text cap.",
  sideEffects: "none" as const,
  authorization: { permission: "content.read" },
  inputSchema: { type: "object", additionalProperties: false, properties: {
    includeWordCounts: { type: "boolean", default: true },
    longest: { type: "integer", minimum: 0, maximum: 20, default: 5 },
  } },
}];

export const contentStatsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> postRepo.list, contentTypeRepo/entryRepo.listByWorkspace, mediaRepo.list,
  // mediaContentTypeStore.getMany and (only for legacy misses) assetBlobRepo.list/blobStore.get.
  // Sniffing is in memory; no metadata backfill or other writes.
  ["content_stats", "none"],
]);

/** Counts each status without interpreting it. O(records) time, O(statuses) space. */
function countStatuses({ rows }: { rows: ReadonlyArray<{ status: string }> }, _optional: Record<string, never> = {}): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return Object.fromEntries(counts);
}

/** Uses exactly the HTML/TipTap extractors used for content_post_list's excerpt/bodyChars.
 * @complexity O(body text + n log n) time and O(n + body text) space for n posts.
 */
function summarizePosts({ rows, includeWordCounts, longest }: { rows: PostRecord[]; includeWordCounts: boolean; longest: number }, _optional: Record<string, never> = {}) {
  const counts = { total: rows.length, byStatus: countStatuses({ rows }) };
  if (!includeWordCounts) return counts;
  const lengths = rows.map(post => {
    const text = (post.bodyFormat === "html" ? extractPlainTextFromHtml({ html: post.bodyHtml ?? "" }) : extractPostPlainText({ bodyJson: post.bodyJson })).trim();
    return { id: post.id, title: post.title, slug: post.slug, words: text === "" ? 0 : text.split(/\s+/u).length };
  });
  const total = lengths.reduce((sum, row) => sum + row.words, 0);
  lengths.sort((a, b) => b.words - a.words || a.id.localeCompare(b.id));
  return { ...counts, words: { total, average: rows.length ? total / rows.length : 0, longest: lengths.slice(0, longest) } };
}

/** Checks an optional section's permission before any of its reads. */
async function canRead({ deps, principalId, permission, entityType }: { deps: ContentStatsToolDeps; principalId: string; permission: string; entityType: string }, _optional: Record<string, never> = {}): Promise<boolean> {
  return (await deps.authorize({ principalId, permission, workspaceId: deps.workspaceId, entityType })).allowed;
}

/** Reads recorded byte types in bulk and sniffs legacy misses without the HTTP list's writeback.
 * Shared blobs are read once, even when several media assets refer to them.
 * @throws {ToolInputError} If a missing blob prevents an accurate classification.
 * @complexity O(assets + missing blob bytes) time, O(assets + largest missing blob) space;
 * two bulk metadata reads at most, with sequential byte reads only for unrecorded legacy types.
 */
async function readMediaTypes({ deps, assets }: { deps: ContentStatsToolDeps; assets: ReadonlyArray<{ source: { sha256: string } }> }, _optional: Record<string, never> = {}): Promise<Map<string, string>> {
  const scope = { workspaceId: deps.workspaceId };
  const sha256s = [...new Set(assets.map(asset => asset.source.sha256))];
  const types = new Map(await deps.mediaContentTypeStore.getMany({ ...scope, sha256s }));
  const missing = sha256s.filter(hash => !types.has(hash));
  if (!missing.length) return types;
  const blobs = new Map((await deps.assetBlobRepo.list(scope)).map(blob => [blob.sha256, blob.storageKey]));
  for (const sha256 of missing) {
    const storageKey = blobs.get(sha256);
    if (!storageKey) throw new ToolInputError({ message: `content_stats: media blob '${sha256}' is missing. Inspect the media library before retrying the count.` });
    types.set(sha256, sniffContentType({ bytes: await deps.blobStore.get({ storageKey }) }));
  }
  return types;
}

/** Validates the optional knobs; omitted means the catalog defaults (true, 5).
 * @throws {ToolInputError} If includeWordCounts is not a boolean or longest is not an integer 0..20.
 */
function parseStatsOptions(input: Record<string, unknown>): { includeWordCounts: boolean; longest: number } {
  const includeWordCounts = input.includeWordCounts === undefined ? true : input.includeWordCounts;
  const longest = input.longest === undefined ? 5 : input.longest;
  if (typeof includeWordCounts !== "boolean") throw new ToolInputError({ message: "content_stats: includeWordCounts must be a boolean." });
  if (typeof longest !== "number" || !Number.isInteger(longest) || longest < 0 || longest > 20) throw new ToolInputError({ message: "content_stats: longest must be an integer from 0 to 20." });
  return { includeWordCounts, longest };
}

/** Counts entries per live, non-widget content type, sorted by key; types with no entries count zero.
 * @complexity O(types log types + entries) time, O(types + entries) space; two bulk reads.
 */
async function summarizeEntries(deps: ContentStatsToolDeps, scope: { workspaceId: string }) {
  const types = (await deps.contentTypeRepo.listByWorkspace(scope)).filter(type => type.status !== "tombstone" && type.key !== "widget" && type.key !== "widget_area");
  const entries = await deps.entryRepo.listByWorkspace(scope);
  const grouped = new Map<string, Array<{ status: string }>>();
  for (const entry of entries) {
    const group = grouped.get(entry.type) ?? [];
    group.push(entry);
    grouped.set(entry.type, group);
  }
  return types.sort((a, b) => a.key.localeCompare(b.key)).map(type => {
    const rows = grouped.get(type.key) ?? [];
    return { contentType: type.key, total: rows.length, byStatus: countStatuses({ rows }) };
  });
}

/** Buckets active media by byte type (image/*, video/*, everything else).
 * @throws {ToolInputError} From readMediaTypes when a legacy blob is missing.
 * @complexity O(assets + missing blob bytes) time, O(assets) space.
 */
async function summarizeMedia(deps: ContentStatsToolDeps, scope: { workspaceId: string }) {
  const assets = (await deps.mediaRepo.list(scope)).filter(asset => asset.status === "active");
  const types = await readMediaTypes({ deps, assets });
  const media = { total: assets.length, images: 0, videos: 0, other: 0 };
  for (const asset of assets) {
    const mime = types.get(asset.source.sha256);
    if (mime === undefined) throw new Error("Content statistics have no media type for an asset");
    if (mime.startsWith("image/")) media.images++;
    else if (mime.startsWith("video/")) media.videos++;
    else media.other++;
  }
  return media;
}

/** Builds the read-only inventory tool. Bad options/denied content are ToolInputError refusals;
 * optional permissions omit sections. All inventory scans are complete, never sampled.
 * @example buildContentStatsRegistrations(deps)[0].handler(ctx)
 * @complexity O(records + text + posts log posts) time, O(records + text) space; bulk repository reads.
 */
export function buildContentStatsRegistrations({ deps }: { deps: ContentStatsToolDeps }, _optional = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "content-stats", catalogModule: "features/post/content-stats-tool.ts", catalog: indexCatalogById({ catalog: contentStatsAgentToolCatalog }), derivedRisk: contentStatsDerivedRisk, handlers: withModelFacingErrors({ handlers: {
    content_stats: async ctx => {
      const { includeWordCounts, longest } = parseStatsOptions(requireInputRecord({ input: ctx.input }));
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "content.read" }, { entityType: "post" });
      const scope = { workspaceId: deps.workspaceId };
      const posts = (await deps.postRepo.list(scope)).filter(post => !post.deletedAt);
      const result: Record<string, unknown> = {
        posts: summarizePosts({ rows: posts.filter(post => post.kind === "post"), includeWordCounts, longest }),
        pages: summarizePosts({ rows: posts.filter(post => post.kind === "page"), includeWordCounts, longest }),
      };
      const omitted: string[] = [];
      if (await canRead({ deps, principalId: ctx.principal.id, permission: "admin.collections.read", entityType: "entry" })) result.entries = await summarizeEntries(deps, scope);
      else omitted.push("entries");
      if (await canRead({ deps, principalId: ctx.principal.id, permission: "media.read", entityType: "media" })) result.media = await summarizeMedia(deps, scope);
      else omitted.push("media");
      if (omitted.length) result.omitted = omitted;
      return result;
    },
  }, rules: [forbiddenRule({ domainPrefix: "CONTENT_STATS", error: ForbiddenError })] }) });
}

/** Installs under a unique domain key, preserving the existing post contributor. */
export function contributeContentStatsTools(_required: Record<string, never> = {}, _optional = {}): ToolContributor<ContentStatsToolDeps, unknown> {
  return { domain: "content-stats", build: deps => buildContentStatsRegistrations({ deps }), risk: contentStatsDerivedRisk };
}

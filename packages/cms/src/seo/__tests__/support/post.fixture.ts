import type { SeoPostRecord } from "../../ports.js";
import { extractPlainTextFromHtml } from "./html-plain-text.fixture.js";

export interface PostRecord extends SeoPostRecord {
  createdAt?: string | null | undefined;
  createdByPrincipalId?: string | null | undefined;
}


/**
 * @file The one shared `PostRecord` builder for tests.
 *
 * `PostRecord` gains required fields over time (`bodyFormat`/`bodyHtml`, SPEC-047/ADR-056 Decision 3),
 * and every hand-rolled literal then stops type-checking at once. Building through here keeps a new
 * required field a one-line change: give it its `createPost` value below and every caller is current.
 */

/**
 * Builds a live, published `"doc"` post, with `fields` overriding any default.
 *
 * Defaults match what `createPost` writes for a plain post: `bodyFormat: "doc"`, `bodyHtml: null`
 * (an `"html"` body is only ever written by `PagesHtmlDocumentStore`), version 1, no trash marker.
 *
 * @param fields the values the test cares about; everything else takes the default.
 * @returns a fresh record; nested `bodyJson` is not shared between calls.
 * @complexity O(fields), one spread.
 */
export function buildPostRecord(fields: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1",
    workspaceId: "workspace-1",
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    bodyFormat: "doc",
    bodyHtml: null,
    updatedAt: "2026-04-06T00:00:00.000Z",
    version: 1,
    ...fields,
  };
}

/** Narrow in-memory post seam; reads return snapshots so CAS races preserve the competing row. */
export class InMemoryPostRepo {
  private rows: Map<string, PostRecord>;
  private revisions: Array<Parameters<InMemoryPostRepo["appendRevision"]>[0]> = [];
  constructor(rows: PostRecord[] = []) {
    this.rows = new Map(rows.map(row => [this.key(row.workspaceId, row.id), structuredClone(row)]));
  }
  private key(workspaceId: string, id: string) { return `${workspaceId}:${id}`; }
  async findById(input: { workspaceId: string; id: string }) {
    const row = this.rows.get(this.key(input.workspaceId, input.id));
    return row ? structuredClone(row) : null;
  }
  async findBySlug(input: { workspaceId: string; slug: string }) {
    return (await this.list(input)).find(row => row.slug === input.slug) ?? null;
  }
  async list(input: { workspaceId: string }) {
    return [...this.rows.values()].filter(row => row.workspaceId === input.workspaceId).map(row => structuredClone(row));
  }
  async save(record: PostRecord) { this.rows.set(this.key(record.workspaceId, record.id), structuredClone(record)); }
  async saveIfVersion(input: { record: PostRecord; ifVersion: number }) {
    const key = this.key(input.record.workspaceId, input.record.id);
    if (this.rows.get(key)?.version !== input.ifVersion) return { applied: false };
    await this.save(input.record);
    return { applied: true };
  }
  async transaction<T>(input: { fn: () => Promise<T> } | (() => Promise<T>)): Promise<T> {
    const rows = structuredClone(this.rows);
    const revisions = structuredClone(this.revisions);
    try { return await (typeof input === "function" ? input : input.fn)(); }
    catch (error) { this.rows = rows; this.revisions = revisions; throw error; }
  }
  async appendRevision(input: {
    postId: string; workspaceId: string; seq: number; op: "update";
    stateJson: SeoPostRecord; actorId: string; recordedAt: string;
  }) { this.revisions.push(structuredClone(input)); }
  async listRevisions(input: { workspaceId: string; postId: string }) {
    return structuredClone(this.revisions.filter(row => row.workspaceId === input.workspaceId && row.postId === input.postId));
  }
  async softDelete(input: { workspaceId: string; id: string; deletedAt: string; updatedAt: string; version: number }) {
    const row = await this.findById(input);
    if (row) await this.save({ ...row, deletedAt: input.deletedAt, updatedAt: input.updatedAt, version: input.version });
  }
  async hardDelete(input: { workspaceId: string; id: string }) { this.rows.delete(this.key(input.workspaceId, input.id)); }
  // Compatibility methods only forwarded by the concurrency fixture, never consumed by SEO.
  async listPublishedPreviews(input: { workspaceId: string; limit: number }) { return (await this.list(input)).filter(row => row.status === "published").slice(0,input.limit); }
  async readAutosave(_input: { workspaceId: string; postId?: string; id?: string }) { return null; }
  async writeAutosave(_input: unknown) { return { applied: true }; }
  async clearAutosave(_input: unknown) {}
  extractPlainText({ html }: { html: string }) { return extractPlainTextFromHtml(html); }
  isTrashed({ post }: { post: SeoPostRecord }) { return post.deletedAt != null; }
}

/** Shape retained only for the original forwarding/race double; production uses the narrow ports. */
export type PostRepoPort = Pick<InMemoryPostRepo,
  "findById" | "findBySlug" | "list" | "save" | "saveIfVersion" | "transaction" | "appendRevision" |
  "listRevisions" | "softDelete" | "hardDelete" | "listPublishedPreviews" | "readAutosave" | "writeAutosave" | "clearAutosave"
>;
export const ROOT_SLUG = "/";

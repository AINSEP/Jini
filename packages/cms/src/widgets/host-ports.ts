import type { Clock, JsonObject } from "@jini-ai/core/primitives";
import type { OutboxPort } from "../core/ports.js";
import type { createEntry, updateEntry, importEntry, toEntryOutbox } from "../entries/index.js";
import type { registerContentType, toContentTypeOutbox, IndexProvisionerPort } from "../content-types/index.js";
import type { findMediaByIdOrSlug, getLatestTransformDefinition } from "../media/index.js";
import type { EntryRefRow } from "./ports.js";

/** Host-owned post snapshot: only the fields the widgets services read or forward. */
export interface PostRecord {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  bodyJson: JsonObject;
  status: "draft" | "published";
  kind: "post" | "page";
  bodyFormat: "doc" | "html";
  updatedAt: string;
  version: number;
  deletedAt?: string | null;
  publishAt?: string | null;
  templateChoice?: string | null;
  overridesThemePage?: boolean | null;
  ext?: JsonObject;
}

/** Host-owned blob content-type lookup; absent sha256 keys mean the blob has not been sniffed yet.
 * Widgets only consumes batch reads; the host retains storage and write ownership. */
export interface MediaContentTypeStorePort {
  getMany(required: { workspaceId: string; sha256s: readonly string[] }): Promise<Map<string, string>>;
}

/** Reads stay host-owned; post writes below receive this same bound repository. */
export interface PostRepoPort {
  findById(required: { workspaceId: string; id: string }): Promise<PostRecord | null>;
  findBySlug(required: { workspaceId: string; slug: string }): Promise<PostRecord | null>;
}

export type ForgetRemovedPostFn = (required: { workspaceId: string; id: string }) => Promise<void>;
export type BeforeSaveHookPort = (entry: {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly slug: string;
  readonly status: PostRecord["status"];
  readonly bodyJson: Readonly<Record<string, unknown>>;
  readonly ext: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}) => Promise<JsonObject>;

type PostWriteDeps = { repo: PostRepoPort; clock: Clock; outbox: OutboxPort; beforeSaveHook?: BeforeSaveHookPort | undefined };
type PostAttribution = { actorId?: string; delegatedByWorkspaceId?: string | null | undefined; delegatedById?: string | null | undefined };

/** Required host behavior. No sibling-domain value enters the widgets runtime closure. */
export interface WidgetHostPorts {
  entries: {
    createEntry: typeof createEntry;
    updateEntry: typeof updateEntry;
    importEntry: typeof importEntry;
    toEntryOutbox: typeof toEntryOutbox;
    isVersionConflict(error: unknown): boolean;
  };
  contentTypes: {
    registerContentType: typeof registerContentType;
    toContentTypeOutbox: typeof toContentTypeOutbox;
    createIndexProvisioner(): IndexProvisionerPort;
    alreadyExists(error: unknown): { tombstoned: boolean } | null;
  };
  posts: {
    isTrashed(post: PostRecord): boolean;
    isVersionConflict(error: unknown): error is Error & { currentVersion: number };
    isNotFound(error: unknown): boolean;
    updatePost(required: {
      deps: PostWriteDeps;
      input: PostAttribution & {
        workspaceId: string; id: string; title: string; slug: string;
        status: PostRecord["status"]; bodyJson: JsonObject; expectedVersion: number;
      };
    }, optional?: Record<string, never>): Promise<{ post: PostRecord }>;
    restorePostForward(required: {
      deps: PostWriteDeps & { forgetRemoved: ForgetRemovedPostFn };
      input: PostAttribution & { prior: PostRecord };
    }, optional?: Record<string, never>): Promise<unknown>;
    findPublishedPostById(required: { deps: { repo: PostRepoPort }; input: { workspaceId: string; id: string } }, optional?: Record<string, never>): Promise<PostRecord | null>;
    findPublishedPostBySlug(required: { deps: { repo: PostRepoPort }; input: { workspaceId: string; slug: string } }, optional?: Record<string, never>): Promise<PostRecord | null>;
  };
  media: {
    findMediaByIdOrSlug: typeof findMediaByIdOrSlug;
    getLatestTransformDefinition: typeof getLatestTransformDefinition;
    publicTransformName: string;
  };
  entryRefs: {
    extract(required: {
      workspaceId: string; sourceEntryId: string; sourceEntryType: string;
      bodyJson: unknown; fieldsExt: Record<string, unknown>;
    }, optional?: Record<string, never>): readonly EntryRefRow[];
  };
  slugify(text: string): string;
}

import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { TransformDefinitionRepoPort } from "../index.js";
import type { MediaContentTypeStorePort } from "./content-type-store.js";

/**
 * Hands one asset's removal to whoever owns removal in this composition.
 *
 * Structurally typed ON PURPOSE — this file imports nothing from `features/trash`, exactly as
 * `post.ts`'s `RemovePostFn` and the comments write-service's `RemoveCommentFn` do not. The
 * composition root binds the real implementation, already bound to this domain's entity type.
 */
export type RemoveMediaFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;


/** The exact deps the host's `resolveMediaPublicUrls` (read: `getMany`) and the host's media tool registrations builder's
 *  `recordUploadContentType` wiring (write: `set` — see the host builder's header, "Content-type recording")
 *  need beyond `MediaToolDeps`'s own fields — both OPTIONAL so a test double (or a future host reusing
 *  that builder without wiring these) can omit them without throwing. Missing
 *  content-type storage leaves all URLs unresolved; missing transforms leaves only image URLs
 *  unresolved. Content-type recording is a no-op without its store. `RouteDeps` (this host's real
 *  composition-root deps bag) always supplies both in production — `mediaContentTypeStore`/
 *  `transformDefinitionRepo` are established fields of the host's route deps bag, not new
 *  wiring this file introduces. `mediaContentTypeStore` is `Pick`-narrowed to only the two methods
 *  this file actually calls, not the whole `MediaContentTypeStorePort`, so a caller passing a
 *  purpose-built double for either half never needs to fake the other. */
export interface MediaPublicUrlDeps {
  tracker?: Tracker;
  mediaContentTypeStore?: Pick<MediaContentTypeStorePort, "getMany" | "set">;
  transformDefinitionRepo?: TransformDefinitionRepoPort;
}


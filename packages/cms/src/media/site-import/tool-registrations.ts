import { captureMediaUploaded } from "../site/analytics.js";
import { withChatPreview } from "../site/chat-preview.js";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { ImageCodecPort, MediaProvenance, MediaRecord, StagedMediaFile } from "@jini-ai/core/contracts/site/cms-media";
import type { ImportedMediaView, MediaImportRefusalPorts, MediaImportSourcePorts, MediaLocalImportStoragePorts, MediaToolStoragePorts, MediaToolUploadInput } from "@jini-ai/core/contracts/site/media-tool-ports";
import { toolMetadata } from "@jini-ai/core/tool-metadata/media-import";
import { buildDomainRegistrations, indexCatalogById, optionalString, requireInputRecord, requireString, requireToolPermission, withSchemaOnRejection, type AgentToolDefinition, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolContributor, type ToolHandler, type ToolPermissionAuthorizationPort, type ToolRegistration } from "@jini-ai/core";
import { sniffContentType, MediaValidationError } from "../index.js";
import { buildImportFilename, MediaImportValidationError } from "../import/index.js";

export interface MediaImportToolDeps {
  workspaceId: string;
  authorize: ToolPermissionAuthorizationPort;
  storage: MediaLocalImportStoragePorts;
  source: MediaImportSourcePorts;
  refusals: MediaImportRefusalPorts;
  tracker?: Tracker;
  imageCodec?: ImageCodecPort;
  readonly refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
  replacement: {
    findById(required: { id: string }, optional?: Record<string, never>): Promise<MediaRecord | null>;
    isAvailable(required: Record<string, never>, optional?: Record<string, never>): boolean;
    replace(required: { media: MediaRecord; bytes: Uint8Array; contentType: string; provenance: MediaProvenance; principalId: string }, optional: { signal: AbortSignal }): Promise<MediaRecord | null>;
  };
}

const DOMAIN = "media-import";

/**
 * Decides which of this tool's rejections are the CALLER's to fix — the predicate
 * `withSchemaOnRejection` turns into a `ToolInputError`, which `@jini-ai/daemon`'s `ToolExecutor`
 * tags `errorKind: 'validation'` and `@jini-ai/http-kit`'s `delegatedToolExecuteRoute` answers as a
 * `400 BAD_REQUEST` carrying the message, instead of SEC-005-redacting it into a bare
 * `INTERNAL_ERROR`.
 *
 * Two classes, for one reason each:
 *
 * - `MediaImportValidationError` — a bad scheme, a non-200, bytes that are not an importable image.
 * - `EgressRefusedError` — the egress policy refused the target: a non-public resolved address
 *   (`169.254.169.254` and friends), a disallowed scheme, or credentials in the URL, on the first
 *   hop or any re-verified redirect. Added 2026-09-07 (SEC-05): it was previously unclassified, so
 *   every SSRF block — the guard doing precisely its job — reached the operator and the model as
 *   "an internal error occurred", with the reason stripped and the audit row recording a crash
 *   rather than a block. Hours of live debugging went into that message.
 *
 * The marker is the honest classification for both, not a trick to defeat the redaction: it means
 * "the caller's input was the problem and a different input would fix it", and a different
 * (publicly reachable) URL does fix an egress refusal. The refusal reaches the caller only in its
 * `callerSafeMessage` form — the host the caller supplied and the classification, never the address
 * it resolved to ({@link withCallerSafeEgressRefusal}). Same precedent as `features/post`'s
 * `PostVersionConflictError` and `features/media`'s `AttachmentRejectedError` re-classifications.
 *
 * Deliberately NOT widened to "anything the HTTP client threw": a DNS failure, a connect timeout,
 * or a transport error are not decisions this process made, a different URL does not reliably fix
 * them, and their text can carry internal detail. Those keep the redacted-`internal` path, which
 * `assistant/__tests__/tool-registrations.media-import-egress-refusal.integration.test.ts` pins
 * with a negative control alongside the positive ones.
 *
 * @complexity O(1) — two `instanceof` checks.
 */
export function isImportShapeRejection(
  { error, refusals }: { error: unknown; refusals: Pick<MediaImportRefusalPorts, "isEgressRefusal"> },
  _optional: Record<string, never> = {},
): boolean {
  return error instanceof MediaImportValidationError || refusals.isEgressRefusal({ error }, {});
}

/**
 * Runs `work`, narrowing any `EgressRefusedError` it throws to its `callerSafeMessage` BEFORE
 * `withSchemaOnRejection` reads `.message` — the same narrowing
 * `features/custom-credentials/tool-registrations.ts`'s `makeModelFacingCredentialedRequest` applies.
 *
 * `.message` names the address the hostname resolved to. A model that can name any host and read
 * back its resolved address can map internal DNS one import at a time (`internal-db.corp` ->
 * `10.0.4.7`). That full message is logged server-side instead; it carries a hostname, an address,
 * and a class, never request content (`Jini packages/platform/src/http/guarded/errors.ts` documents it as the log-facing half).
 *
 * Exported for `theme_import_file_from_url` (`features/theme/import-theme-file-tool.ts`), which
 * fetches through the same client and needs the identical narrowing; `toolId` names it in the log.
 *
 * @complexity O(1) beyond `work` itself.
 */
export async function withCallerSafeEgressRefusal<T>(
  { refusals, work }: { refusals: MediaImportRefusalPorts; work: () => Promise<T> },
  { toolId = "media_import_from_url" }: { toolId?: string } = {},
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const refusal = refusals.describeEgressRefusal({ error: err }, {});
    if (refusal === undefined) throw err;
    refusals.logEgressRefusal({ line: `[media-import] ${toolId} egress refused: ${refusal.logMessage}` }, {});
    throw refusal.callerSafeError;
  }
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls — see `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const mediaImportDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  ["media_replace_file", "mutates-durable-state"],
  ["media_import_from_url", "mutates-durable-state"],
  ["media_import_local_file", "mutates-durable-state"],
]);

/**
 * Persists already-validated bytes through the existing upload/dedupe service, records their sniffed
 * type, and returns the same media projection for either byte source. Storage failures propagate.
 * @complexity O(n) in the uploaded bytes for hashing/storage; fixed-count repository operations.
 */
export async function persistImportedMedia(
  required: { storage: MediaToolStoragePorts; input: MediaToolUploadInput; sourceUrl: string; actorId: string; tracker?: Tracker },
  _optional: Record<string, never> = {},
): Promise<{ media: ImportedMediaView }> {
  const { storage, input, sourceUrl, actorId, tracker } = required;
  const { media } = await storage.upload({ input }, {});
  const sniffed = sniffContentType({ bytes: input.bytes });
  return formatImportedMedia({ storage, media, workspaceId: input.workspaceId, contentType: sniffed, byteLength: input.bytes.byteLength, sourceUrl, actorId, tracker });
}

async function formatImportedMedia({ storage, media, workspaceId, contentType, byteLength, sourceUrl, actorId, tracker }: {
  storage: MediaToolStoragePorts; media: MediaRecord; workspaceId: string; contentType: string; byteLength: number;
  sourceUrl: string; actorId: string; tracker: Tracker | undefined;
}, _optional: Record<string, never> = {}): Promise<{ media: ImportedMediaView }> {
  // Identical recording discipline to the URL, generated-media and admin upload paths.
  await storage.recordContentType({ workspaceId, sha256: media.source.sha256, contentType }, {});
  captureMediaUploaded({ ...(tracker === undefined ? {} : { tracker }), actorId, byteLength, kind: "image", source: "assistant" });
  const urls = await storage.resolvePublicUrls({ assets: [media] }, {});
  return {
    media: {
      id: media.id, slug: media.slug, title: media.title, alt: media.alt, caption: media.caption,
      createdBy: media.createdBy ?? null,
      credit: media.credit, sha256: media.source.sha256, status: media.status, version: media.version,
      publicUrl: urls.get(media.id) ?? null, sourceUrl,
    },
  };
}

/** Read replacement bytes through the existing root containment, secret exclusions and bounded read.
 * @throws FsFilePathError or MediaImportValidationError for unsafe paths or unsupported bytes.
 * @complexity O(b) time/space for b file bytes, bounded by the host upload ceiling. */
async function readLocalReplacement({ routeDeps, input }: { routeDeps: MediaImportToolDeps; input: Record<string, unknown> }, _optional = {}) {
  const relativePath = requireString({ input, key: "path" });
  const request = routeDeps.source.resolveLocal({ root: requireString({ input, key: "root" }), relativePath }, {});
  const maxBytes = routeDeps.source.localReadLimit({ relativePath }, {});
  const bytes = await routeDeps.source.readLocal({ ...request, maxBytes }, {});
  const contentType = routeDeps.source.validateBytes({ source: relativePath, bytes, bytesTruncated: false }, {});
  return { bytes, contentType, provenance: { kind: 'upload' as const, path: request.relativePath } };
}

/** Requires exactly one replacement source before media lookup or source I/O. */
function requireReplacementSource(
  { input }: { input: Record<string, unknown> },
  _optional: Record<string, never> = {},
): boolean {
  const remote = input.url !== undefined;
  if (remote ? input.root !== undefined || input.path !== undefined : input.root === undefined || input.path === undefined) {
    throw new MediaImportValidationError({ message: "Pass either url or root and path, never both." });
  }
  return remote;
}

/** Refuses unless the caller holds `permission` on media — on one entity when `entityId` is given. */
async function requireMediaPermission(
  { routeDeps, principalId, permission }: { routeDeps: MediaImportToolDeps; principalId: string; permission: string },
  { entityId }: { entityId?: string } = {},
): Promise<void> {
  await requireToolPermission({ authorize: routeDeps.authorize,
    workspaceId: routeDeps.workspaceId, principalId, permission },
  { entityType: "media", ...(entityId === undefined ? {} : { entityId }) });
}

async function validateReplacementTarget({ routeDeps, mediaId }: { routeDeps: MediaImportToolDeps; mediaId: string }, _optional = {}): Promise<MediaRecord> {
  const media = await routeDeps.replacement.findById({ id: mediaId }, {});
  if (!media || media.status !== "active") throw new MediaImportValidationError({ message: "Media was not found or is in Trash; restore it before replacing its file." });
  if (!routeDeps.replacement.isAvailable({}, {})) {
    throw new MediaImportValidationError({ message: "Media file replacement is unavailable on this storage adapter." });
  }
  return media;
}

async function readReplacementSource({ routeDeps, input, remote }: { routeDeps: MediaImportToolDeps; input: Record<string, unknown>; remote: boolean }, _optional = {}) {
  return remote
    ? withCallerSafeEgressRefusal({
      refusals: routeDeps.refusals,
      work: async () => {
        const fetched = await routeDeps.source.fetchRemote({ url: requireString({ input, key: "url" }) }, {});
        return { ...fetched, provenance: { kind: 'url' as const, url: fetched.url.href } };
      },
    }, { toolId: "media_replace_file" })
    : readLocalReplacement({ routeDeps, input });
}

function createMediaReplaceFileHandler(routeDeps: MediaImportToolDeps, CATALOG_BY_ID: ReadonlyMap<string, AgentToolDefinition>): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  routeDeps.refuseUnexpectedKeys(input, ["mediaId", "url", "root", "path"]);
  const mediaId = requireString({ input, key: "mediaId" });
  await requireMediaPermission({ routeDeps, principalId: ctx.principal.id, permission: "media.update" }, { entityId: mediaId });
  return withSchemaOnRejection({
    toolId: "media_replace_file", catalog: CATALOG_BY_ID,
    isShapeRejection: ({ error }) => isImportShapeRejection({ error, refusals: routeDeps.refusals }) || routeDeps.refusals.isPathRefusal({ error }, {}) || error instanceof MediaValidationError,
    fn: async () => {
      const remote = requireReplacementSource({ input });
      const media = await validateReplacementTarget({ routeDeps, mediaId });
      const source = await readReplacementSource({ routeDeps, input, remote });
      ctx.signal.throwIfAborted();
      const saved = await routeDeps.replacement.replace({ media, bytes: source.bytes, contentType: source.contentType, provenance: source.provenance, principalId: ctx.principal.id }, { signal: ctx.signal });
      if (!saved) throw new MediaImportValidationError({ message: "Media changed while replacing its file. Read the current item and retry; nothing was replaced." });
      const urls = await routeDeps.storage.resolvePublicUrls({ assets: [saved] }, {});
      const result = { media: { id: saved.id, slug: saved.slug, title: saved.title, version: saved.version, sha256: saved.source.sha256, publicUrl: urls.get(saved.id) ?? null } };
      return withChatPreview({ routeDeps, bytes: source.bytes, contentType: source.contentType, result });
    },
  });
};
}

async function persistLocalImport({ routeDeps, input, relativePath, provenancePath, source, actorId, signal }: {
  routeDeps: MediaImportToolDeps; input: Record<string, unknown>; relativePath: string; provenancePath: string;
  source: { bytes: Uint8Array } | { staged: StagedMediaFile }; actorId: string; signal: AbortSignal;
}, _optional: Record<string, never> = {}): Promise<unknown> {
  const contentType = "bytes" in source
    ? routeDeps.source.validateBytes({ source: relativePath, bytes: source.bytes, bytesTruncated: false }, {})
    : source.staged.contentType;
  const title = optionalString({ input, key: "title" });
  // uploadMedia derives its title by stripping the final extension. A synthetic suffix lets
  // an explicit editorial title keep its punctuation and spaces; this is never a disk path.
  const filename = title === undefined ? relativePath.split(/[\\/]/).at(-1) : `${title}.imported`;
  if (filename === undefined) throw new Error("Media import path has no filename");
  signal.throwIfAborted();
  const persistence = { storage: routeDeps.storage,
    ...(routeDeps.tracker === undefined ? {} : { tracker: routeDeps.tracker }), actorId,
  };
  const uploadInput = { workspaceId: routeDeps.workspaceId, filename, contentType,
    provenance: { kind: 'upload' as const, path: provenancePath },
    alt: optionalString({ input, key: "alt" }), caption: optionalString({ input, key: "caption" }),
    description: optionalString({ input, key: "description" }), createdByPrincipal: actorId,
  };
  if ("bytes" in source) {
    const result = await persistImportedMedia({ ...persistence, input: { ...uploadInput, bytes: source.bytes }, sourceUrl: "" });
    return withChatPreview({ routeDeps, bytes: source.bytes, contentType, result });
  }
  const { media } = await routeDeps.storage.uploadStagedVideo({ input: { ...uploadInput, staged: source.staged } }, { signal });
  return formatImportedMedia({ storage: persistence.storage, media, workspaceId: routeDeps.workspaceId, contentType,
    byteLength: source.staged.byteLength, actorId, tracker: persistence.tracker, sourceUrl: "",
  });
}

async function importLocalStream({ routeDeps, input, request, relativePath, maxBytes, actorId, signal }: {
  routeDeps: MediaImportToolDeps; input: Record<string, unknown>; request: { rootPath: string; relativePath: string };
  relativePath: string; maxBytes: number; actorId: string; signal: AbortSignal;
}, _optional: Record<string, never> = {}): Promise<unknown> {
  return routeDeps.source.withLocalStream({ ...request, maxBytes, consume: async ({ length, chunks }) => {
    if (length <= routeDeps.source.ordinaryMaxBytes) {
      const collected: Uint8Array[] = [];
      for await (const chunk of chunks) collected.push(chunk);
      return persistLocalImport({ routeDeps, input, relativePath, provenancePath: request.relativePath, actorId, signal, source: { bytes: Buffer.concat(collected) } });
    }
    const iterator = chunks[Symbol.asyncIterator]();
    const prefix = Buffer.alloc(Math.min(length, 64 * 1024));
    let filled = 0;
    let remainder: Uint8Array = new Uint8Array();
    while (filled < prefix.length) {
      const next = await iterator.next();
      if (next.done) throw new MediaImportValidationError({ message: "Local file ended before its checked length." });
      const take = Math.min(next.value.length, prefix.length - filled);
      prefix.set(next.value.subarray(0, take), filled);
      filled += take;
      remainder = next.value.subarray(take);
    }
    const contentType = routeDeps.source.validateBytes({ source: relativePath, bytes: prefix, bytesTruncated: false }, {});
    if (!contentType.startsWith("video/")) throw new MediaImportValidationError({ message: `file '${relativePath}' exceeds the ${routeDeps.source.ordinaryMaxBytes}-byte import limit. Nothing was saved.` });
    return routeDeps.source.withStagedFile({ byteLength: length, contentType, chunks: (async function* () {
      yield prefix;
      if (remainder.length) yield remainder;
      while (true) { const next = await iterator.next(); if (next.done) return; yield next.value; }
    })(), consume: staged => persistLocalImport({ routeDeps, input, relativePath, provenancePath: request.relativePath, source: { staged }, actorId, signal }) }, { signal });
  } }, { signal });
}

function createMediaImportLocalFileHandler(routeDeps: MediaImportToolDeps, CATALOG_BY_ID: ReadonlyMap<string, AgentToolDefinition>): ToolHandler {
  return async (ctx): Promise<unknown> => {
  const input = requireInputRecord({ input: ctx.input });
  const root = requireString({ input, key: "root" });
  const relativePath = requireString({ input, key: "path" });
  await requireMediaPermission({ routeDeps, principalId: ctx.principal.id, permission: "media.upload" });

  return withSchemaOnRejection({
    toolId: "media_import_local_file", catalog: CATALOG_BY_ID,
    isShapeRejection: ({ error }) => routeDeps.refusals.isPathRefusal({ error }, {}) || error instanceof MediaImportValidationError || error instanceof MediaValidationError,
    fn: async () => {
      const request = routeDeps.source.resolveLocal({ root, relativePath }, {});
      const maxBytes = routeDeps.source.localReadLimit({ relativePath }, {});
      if (await routeDeps.storage.canUploadStagedVideo({}, { signal: ctx.signal })) {
        return importLocalStream({ routeDeps, input, request, relativePath, maxBytes, actorId: ctx.principal.id, signal: ctx.signal });
      }
      const bytes = await routeDeps.source.readLocal({ ...request, maxBytes }, {});
      return persistLocalImport({ routeDeps, input, relativePath, provenancePath: request.relativePath, source: { bytes }, actorId: ctx.principal.id, signal: ctx.signal });
    },
  });
};
}

function createMediaImportFromUrlHandler(routeDeps: MediaImportToolDeps, CATALOG_BY_ID: ReadonlyMap<string, AgentToolDefinition>): ToolHandler {
  return async (ctx): Promise<unknown> => {
  const input = requireInputRecord({ input: ctx.input });
  const url = requireString({ input, key: "url" });
  await requireMediaPermission({ routeDeps, principalId: ctx.principal.id, permission: "media.upload" });

  return withSchemaOnRejection({
    toolId: "media_import_from_url",
    catalog: CATALOG_BY_ID,
    isShapeRejection: ({ error }) => isImportShapeRejection({ error, refusals: routeDeps.refusals }) || error instanceof MediaValidationError,
    fn: () =>
      withCallerSafeEgressRefusal({ refusals: routeDeps.refusals, work: async () => {
        const fetched = await routeDeps.source.fetchRemote({ url }, {});

        ctx.signal.throwIfAborted();
        const result = await persistImportedMedia({
          storage: routeDeps.storage, ...(routeDeps.tracker === undefined ? {} : { tracker: routeDeps.tracker }), actorId: ctx.principal.id,
          input: {
            workspaceId: routeDeps.workspaceId,
            provenance: { kind: 'url', url: fetched.url.href },
            bytes: fetched.bytes,
            filename: buildImportFilename({ url: fetched.url, contentType: fetched.contentType }, { override: optionalString({ input, key: "filename" }) }),
            contentType: fetched.contentType,
            alt: optionalString({ input, key: "alt" }),
            caption: optionalString({ input, key: "caption" }),
            credit: optionalString({ input, key: "credit" }),
            description: optionalString({ input, key: "description" }),
            createdByPrincipal: ctx.principal.id,
          },
          sourceUrl: fetched.url.href,
        });
        return withChatPreview({ routeDeps, bytes: fetched.bytes, contentType: fetched.contentType, result });
      } })
  });
};
}

/** Builds this domain's permission-gated durable import handlers; root/path validation precedes I/O.
 * @complexity O(1) registration work; handlers are bounded by the upload cap.
 */
export function buildMediaImportRegistrations(
  { deps, catalog }: { deps: MediaImportToolDeps; catalog: readonly AgentToolDefinition[] },
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog });
  const handlers: Record<string, ToolHandler> = {
    /** Authorize before fetching; the admin's shared service owns blob staging and atomic versioning. */
    media_replace_file: createMediaReplaceFileHandler(deps, CATALOG_BY_ID),
    media_import_local_file: createMediaImportLocalFileHandler(deps, CATALOG_BY_ID),
    media_import_from_url: createMediaImportFromUrlHandler(deps, CATALOG_BY_ID),
  };
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: DOMAIN,
    catalogModule: "@jini-ai/cms/media/site-import/agent-tools",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: mediaImportDerivedRisk,
  });
}

/**
 * Contributes `media-import`'s AI tools to the assistant's catalog — called once by
 * `server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`,
 * not by importing this module.
 */
export function contributeMediaImportTools<D>(
  { catalog, bindDeps }: { catalog: readonly AgentToolDefinition[]; bindDeps: (required: { deps: D }, optional?: Record<string, never>) => MediaImportToolDeps },
  _optional: Record<string, never> = {},
): ToolContributor<D, unknown> {
  return { domain: DOMAIN, build: (deps) => buildMediaImportRegistrations({ deps: bindDeps({ deps }, {}), catalog }), risk: mediaImportDerivedRisk };
}

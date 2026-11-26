import { basename, matchesGlob } from "node:path";
import { ToolInputError, buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, withSchemaOnRejection, type AgentToolDefinition, type DerivedRiskByToolId, type HumanConfirmer, type ToolContributor, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler, type ToolRegistration , type AgentToolSideEffect } from "@jini-ai/core";
import type { AssistantSurfaceDeps, HumanConfirmSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { AssetFile, AssetSourceSchema, AssetTheme, OverwritePolicy, PreparedAssetBatch, PreparedAssets } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import { toolMetadata } from "@jini-ai/core/tool-metadata/files-copy";
import type { DocumentArchiveReaderPort } from "../media/document-ingress.js";
import { prepareAssetWrites, requireAssetDestination, writeAssetFiles, type AssetDestinationDeps } from "./asset-destinations.js";

export type AssetApprovalToolHandler = <TPrepared>(
  required: {
    surfaces: HumanConfirmSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<TPrepared>;
    describe: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run: (required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  },
  optional?: { flag?: string; batch?: boolean; ask?: (required: { prepared: TPrepared }) => boolean },
) => ToolHandler;

export interface AssetBatchApproval {
  approvalToolHandler: AssetApprovalToolHandler;
  describeWriteBatch(required: { batch: PreparedAssetBatch<Buffer>; toolId: string }, optional?: Record<string, never>): HumanConfirmSpec;
}

export interface FilesCopyToolDeps<Theme extends AssetTheme> {
  destination: AssetDestinationDeps<Theme>;
  mediaVideoMaxBytes: number;
  readonly refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
  source: {
    readAsset(required: { ctx: ToolExecutionContext; input: unknown; maxBytes: number }, optional?: Record<string, never>): Promise<AssetFile<Buffer>>;
    resolveFolder(required: { ctx: ToolExecutionContext; source: Record<string, unknown> }, optional?: Record<string, never>): Promise<{ rootPath: string; relativePath: string }>;
    list(required: { rootPath: string; relativePath: string }, optional?: Record<string, never>): { files: readonly string[]; truncated: boolean };
    readFile(required: { rootPath: string; relativePath: string; maxBytes: number }, optional?: Record<string, never>): Promise<Buffer>;
    fetchUrl(required: { url: string; media: boolean; maxBytes: number }, optional?: Record<string, never>): Promise<{ bytes: Uint8Array; url: URL }>;
  };
  documentArchiveReader: DocumentArchiveReaderPort;
  documents: {
    maxBytes: number;
    validate(required: { filename: string; bytes: Uint8Array }, optional: { archiveReader: DocumentArchiveReaderPort }): Promise<unknown>;
  };
  isFsShapeRejection(required: { error: unknown }, optional?: Record<string, never>): boolean;
  isDocumentShapeRejection(required: { error: unknown }, optional?: Record<string, never>): boolean;
  isThemeShapeRejection(required: { error: unknown }, optional?: Record<string, never>): boolean;
  isImportShapeRejection(required: { error: unknown }, optional?: Record<string, never>): boolean;
}

// maxFileBytes equals the theme owner's 10 MB import cap (THEME_IMPORT_MAX_BYTES); the catalog is
// built at module load, before any host port exists, so the value is stated here and the copy-tool
// test pins it equal to the theme cap instead of importing the theme feature.
export const FILES_COPY_LIMITS = { maxFiles: 50, maxFileBytes: 10_000_000, maxTotalBytes: 25 * 1024 * 1024 } as const;
export function buildFilesCopyAgentToolCatalog(
  { sourceSchema, fsReadPermission }: { sourceSchema: AssetSourceSchema; fsReadPermission: string },
  _optional: Record<string, never> = {},
): AgentToolDefinition[] {
const catalog: AgentToolDefinition = {
  name: "files_copy",
  description: "Copy/import assets without Bash cp or Python. sources:[{root:'picked'|'site'|'theme'|'media',path,themeId?,glob?}|{root:'url',url,path?}]. " +
    "For a folder, glob filters paths relative to that folder (e.g. '**/*.{png,woff2}'); directory structure is preserved. No glob means one file. " +
    "destination:{kind:'theme',themeId,path:'assets'} | {kind:'site',path:'public/images'} | {kind:'media'} | {kind:'library'}. path is a destination folder for site/theme only. " +
    "Save documents from picked/site/theme files to the private, assistant-only Library with kind:'library'; never publishes them. Supports the Library document allow-list (.md, .txt, .pdf, .docx, etc.), at most 50 MiB/document; filesystem .key files (including Keynote) are refused by the secret guard. Folder paths are flattened to filenames. URL sources remain image/font imports and cannot target Library. For generated text use library_save_attachment {name,content}. " +
    "overwrite:'skip' (default), 'overwrite' or 'rename' for site/theme paths; media and Library documents are always added as new items. " +
    "Returns written/skipped paths, private documents, media URLs or theme status. Theme/media/Library edits use their existing permissions; site files use fs_write_files batch approval. Never writes to picked folders: use fs_write_files. " +
    "All sources are checked before writing; secrets, symlinks, escapes and truncated folder listings are refused. URLs use the existing SSRF-guarded image/font fetch. " +
    `Caps: ${FILES_COPY_LIMITS.maxFiles} files, ${FILES_COPY_LIMITS.maxFileBytes} bytes/asset, ${FILES_COPY_LIMITS.maxTotalBytes} bytes total (Library: 50 MiB/file and 50 MiB/batch); one non-glob video copied into Media may use the host video byte cap; site writer additionally caps 2 MiB/file and 10 MiB/batch.`,
  sideEffects: "mutates-durable-state", authorization: { permission: fsReadPermission },
  inputSchema: { type: "object", additionalProperties: false, required: ["sources", "destination"], properties: {
    sources: { type: "array", minItems: 1, maxItems: FILES_COPY_LIMITS.maxFiles, items: { type: "object", additionalProperties: false, required: ["root"], properties: {
      ...sourceSchema.properties, root: { type: "string", enum: [...sourceSchema.properties.root.enum, "url"] },
      url: { type: "string", minLength: 1 }, glob: { type: "string", minLength: 1, maxLength: 256 },
    } } },
    destination: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: ["site", "theme", "media", "library"] }, path: { type: "string", minLength: 1 }, themeId: { type: "string", minLength: 1 } } },
    overwrite: { type: "string", enum: ["skip", "overwrite", "rename"] },
  } },
};
  return [catalog];
}
export const filesCopyDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([["files_copy", "mutates-durable-state"]]);
const callerError = <Theme extends AssetTheme>({ error, deps }: { error: unknown; deps: FilesCopyToolDeps<Theme> }, _optional = {}) => {
  return deps.isFsShapeRejection({ error }) || deps.isDocumentShapeRejection({ error }) || deps.isThemeShapeRejection({ error }) || deps.isImportShapeRejection({ error });
};

/** URL sources reuse fetchImage and its safe egress port, with the existing theme font sniffer. */
async function readUrl<Theme extends AssetTheme>({ deps, source, media, maxBytes }: { deps: FilesCopyToolDeps<Theme>; source: Record<string, unknown>; media: boolean; maxBytes: number }): Promise<AssetFile<Buffer>> {
  if (source.glob !== undefined) throw new ToolInputError({ message: "URL sources do not accept glob" });
  const url = requireString({ input: source, key: "url" });
  const fetched = await deps.source.fetchUrl({ url, media, maxBytes }, {});
  return { bytes: Buffer.from(fetched.bytes), path: source.path === undefined ? basename(fetched.url.pathname) : requireString({ input: source, key: "path" }), sourceUrl: fetched.url.href };
}

/** Validate the native glob input separately from filesystem I/O. */
function requireGlob({ glob, root }: { glob: unknown; root: unknown }): string {
  if (typeof glob !== "string" || !glob || glob.length > 256 || root === "media") throw new ToolInputError({ message: "glob must be 1..256 characters and target a filesystem folder" });
  return glob;
}

/** Expand folders through the existing bounded listing. A truncated listing cannot imply completeness.
 * The listing skips symlinks; each entry is re-walked on read because it may have changed since. */
async function readLocal<Theme extends AssetTheme>({ deps, ctx, source, maxBytes }: { deps: FilesCopyToolDeps<Theme>; ctx: ToolExecutionContext; source: Record<string, unknown>; maxBytes: number }, _options = {}): Promise<AssetFile<Buffer>[]> {
  const { glob, ...input } = source;
  if (glob === undefined) {
    const file = await deps.source.readAsset({ ctx, input, maxBytes }, {});
    return [{ ...file, path: basename(file.path) }];
  }
  const pattern = requireGlob({ glob, root: source.root });
  const { rootPath, relativePath: folder } = await deps.source.resolveFolder({ ctx, source: input }, {});
  const listing = deps.source.list({ rootPath, relativePath: folder }, {});
  const paths = listing.files.filter((path) => matchesGlob(path, pattern));
  if (listing.truncated || paths.length > FILES_COPY_LIMITS.maxFiles) throw new ToolInputError({ message: "Folder glob exceeds the file-count/traversal cap; narrow the folder or glob" });
  const files: AssetFile<Buffer>[] = [];
  let total = 0;
  for (const path of paths) {
    const bytes = await deps.source.readFile({ rootPath, relativePath: folder === "." ? path : `${folder}/${path}`, maxBytes }, {});
    total += bytes.length;
    // A Library batch must admit one document at its allowed per-file maximum.
    if (total > Math.max(FILES_COPY_LIMITS.maxTotalBytes, maxBytes)) throw new ToolInputError({ message: "Folder glob exceeds the total byte cap" });
    files.push({ path, bytes });
  }
  return files;
}

/** Authorize, stage and validate the complete aggregate before any card or write.
 * @throws Input/root/permission errors. @complexity O(total bytes + bounded folder entries). */
async function prepare<Theme extends AssetTheme>({ deps, ctx }: { deps: FilesCopyToolDeps<Theme>; ctx: ToolExecutionContext }, _options = {}): Promise<PreparedAssets<Buffer>> {
  const input = requireInputRecord({ input: ctx.input });
  deps.refuseUnexpectedKeys(input, ["sources", "destination", "overwrite"]);
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > FILES_COPY_LIMITS.maxFiles) throw new ToolInputError({ message: "sources must list 1..50 entries" });
  const { destination, prefix } = await requireCopyDestination({ deps, ctx, input: input.destination });
  const maxFileBytes = destination.kind === "library" ? deps.documents.maxBytes : destination.kind === "media" && input.sources.length === 1 ? deps.mediaVideoMaxBytes : FILES_COPY_LIMITS.maxFileBytes;
  let policy: OverwritePolicy;
  switch (input.overwrite ?? "skip") {
    case "skip": policy = "skip"; break;
    case "overwrite": policy = "overwrite"; break;
    case "rename": policy = "rename"; break;
    default: throw new ToolInputError({ message: "overwrite must be skip, overwrite or rename" });
  }
  const files: AssetFile<Buffer>[] = [];
  for (const raw of input.sources) {
    const group = await readGroup({ deps, ctx, raw, kind: destination.kind, maxFileBytes });
    appendFiles({ files, group, prefix }, { maxFileBytes });
  }
  return prepareAssetWrites({ deps: deps.destination, destination, files: destination.kind === "library" ? await prepareLibraryFiles({ deps, files }) : files, policy });
}

/** Preflight every document before saving any; Jini owns type/signature/archive and size guards.
 * Library has no directories; display filenames are flattened, and ingress rejects invalid names.
 * @throws MediaValidationError (the existing shape-rejection path). @complexity O(total bytes), bounded. */
async function prepareLibraryFiles<Theme extends AssetTheme>({ deps, files }: { deps: FilesCopyToolDeps<Theme>; files: AssetFile<Buffer>[] }, _options = {}): Promise<AssetFile<Buffer>[]> {
  const documents = files.map(file => ({ ...file, path: basename(file.path) }));
  for (const file of documents) await deps.documents.validate({ filename: file.path, bytes: file.bytes }, { archiveReader: deps.documentArchiveReader });
  return documents;
}

/** Authorized destination plus its folder prefix (theme default 'assets'); never the picked folder. */
async function requireCopyDestination<Theme extends AssetTheme>({ deps, ctx, input }: { deps: FilesCopyToolDeps<Theme>; ctx: ToolExecutionContext; input: unknown }, _options = {}) {
  const raw = requireInputRecord({ input });
  if (raw.kind === "picked") throw new ToolInputError({ message: "Use fs_write_files to write to the picked folder" });
  const destination = await requireAssetDestination({ deps: deps.destination, ctx, input: raw });
  if ((destination.kind === "media" || destination.kind === "library") && raw.path !== undefined) throw new ToolInputError({ message: "Media and Library destinations do not have folders; omit destination.path" });
  const defaultPrefix = destination.kind === "theme" ? "assets" : "";
  const prefix = raw.path === undefined ? defaultPrefix : requireString({ input: raw, key: "path" });
  return { destination, prefix };
}

/** Select a source adapter after rejecting contradictory URL fields. */
async function readGroup<Theme extends AssetTheme>({ deps, ctx, raw, kind, maxFileBytes }: { deps: FilesCopyToolDeps<Theme>; ctx: ToolExecutionContext; raw: unknown; kind: PreparedAssets<Buffer>['destination']['kind']; maxFileBytes: number }, _options = {}): Promise<AssetFile<Buffer>[]> {
  const source = requireInputRecord({ input: raw });
  deps.refuseUnexpectedKeys(source, ["root", "path", "url", "themeId", "glob"]);
  if (source.root !== "url" && source.url !== undefined) throw new ToolInputError({ message: "url is only valid for root url" });
  if (source.root === "url" && kind === "library") throw new ToolInputError({ message: "Library copies need an allowed picked/site/theme file source, not an image URL" });
  const readLimit = kind === "media" && source.glob !== undefined ? FILES_COPY_LIMITS.maxFileBytes : maxFileBytes;
  const files = source.root === "url"
    ? [await readUrl({ deps, source, media: kind === "media", maxBytes: maxFileBytes })]
    : await readLocal({ deps, ctx, source, maxBytes: readLimit });
  if (kind === "media" && files.some(file => file.bytes.length > FILES_COPY_LIMITS.maxFileBytes && !deps.destination.media.validateBytes({ source: file.path, bytes: file.bytes, bytesTruncated: false }, {}).startsWith("video/"))) {
    throw new ToolInputError({ message: "Copy exceeds the byte cap for non-video assets" });
  }
  return files;
}

/** Aggregate caps count all sources together; failure occurs before destination persistence. */
function appendFiles({ files, group, prefix }: { files: AssetFile<Buffer>[]; group: AssetFile<Buffer>[]; prefix: string }, { maxFileBytes = FILES_COPY_LIMITS.maxFileBytes }: { maxFileBytes?: number } = {}): void {
  for (const file of group) files.push({ ...file, path: prefix ? `${prefix}/${file.path}` : file.path });
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  // Retain other destinations' aggregate cap while admitting one maximum-size Library document.
  if (files.length > FILES_COPY_LIMITS.maxFiles || total > Math.max(FILES_COPY_LIMITS.maxTotalBytes, maxFileBytes) || group.some((file) => file.bytes.length > maxFileBytes)) throw new ToolInputError({ message: "Copy exceeds file-count or byte caps; split the selection" });
}

/** Register one generic copy tool; site writes reuse the existing approval exchange.
 * @returns One registration. @complexity O(1). @example buildFilesCopyRegistrations(deps, surfaces); */
export function buildFilesCopyRegistrations<Theme extends AssetTheme>(
  { deps, surfaces, catalog, approval }: { deps: FilesCopyToolDeps<Theme>; surfaces: HumanConfirmSurfaceDeps; catalog: readonly AgentToolDefinition[]; approval: AssetBatchApproval },
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  const byId = indexCatalogById({ catalog });
  const handler = approval.approvalToolHandler<PreparedAssets<Buffer>>({ surfaces,
    prepare: ({ ctx }) => withSchemaOnRejection({ toolId: "files_copy", catalog: byId, isShapeRejection: ({ error }) => callerError({ error, deps }), fn: () => prepare({ deps, ctx }) }),
    describe: ({ prepared }) => approval.describeWriteBatch({ batch: prepared.batch ?? { folder: "", writes: [] }, toolId: "files_copy" }, {}),
    run: async ({ ctx, prepared }) => {
      if (!prepared.files.length) return { applied: false, written: [], skipped: prepared.skipped };
      const result = await writeAssetFiles({ deps: deps.destination, ctx, prepared });
      return { applied: !("failed" in result), ...result };
    },
  }, { flag: "applied", ask: ({ prepared }) => prepared.batch !== undefined });
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "files-copy", catalogModule: "@jini-ai/cms/asset-transfer/copy-tool", catalog: byId, handlers: { files_copy: handler }, derivedRisk: filesCopyDerivedRisk });
}

/** Composition contribution; its own key preserves the existing fs-files catalog. */
export function contributeFilesCopyTools<D, Theme extends AssetTheme>(
  { catalog, approval, bindDeps }: { catalog: readonly AgentToolDefinition[]; approval: AssetBatchApproval; bindDeps: (required: { deps: D }, optional?: Record<string, never>) => FilesCopyToolDeps<Theme> },
  _optional: Record<string, never> = {},
): ToolContributor<D, AssistantSurfaceDeps> {
  return { domain: "files-copy", build: (deps, surfaces) => buildFilesCopyRegistrations({ deps: bindDeps({ deps }, {}), surfaces, catalog, approval }), risk: filesCopyDerivedRisk };
}

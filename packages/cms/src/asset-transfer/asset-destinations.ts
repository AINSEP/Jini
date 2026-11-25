import { basename } from "node:path";
import { ToolInputError, requireInputRecord, requireString, requireToolPermission, type ToolExecutionContext, type ToolPermissionAuthorizationPort } from "@jini-ai/core";
import type { AssetDestination, AssetFile, AssetTheme, OverwritePolicy, PreparedAssetBatch, PreparedAssets } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import type { ImportedMediaView, MediaImportSourcePorts, MediaToolUploadInput } from "@jini-ai/core/contracts/site/media-tool-ports";

export interface AssetDestinationDeps<Theme extends AssetTheme> {
  workspaceId: string;
  authorize: ToolPermissionAuthorizationPort;
  permissions: Readonly<Record<AssetDestination["kind"], string>>;
  readonly refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
  fs: {
    siteFolder(required: Record<string, never>, optional?: Record<string, never>): string;
    inspect(required: { folder: string; path: string }, optional?: Record<string, never>): { overwrite: boolean };
    prepareSite(required: { folder: string; files: { path: string; content: string; encoding: "base64" }[] }, optional?: Record<string, never>): PreparedAssetBatch<Buffer>;
    preparePicked(required: { files: { path: string; content: string; encoding: "base64" }[] }, optional?: Record<string, never>): PreparedAssetBatch<Buffer>;
    writePrepared(required: { folder: string; writes: PreparedAssetBatch<Buffer>["writes"] }, optional?: Record<string, never>): { written: string[]; notWritten: string[]; failed?: { path: string; reason: string } };
    chooseNextName(required: { desiredPath: string; existingPaths: Set<string> }, optional?: Record<string, never>): string;
  };
  theme: {
    findTheme(required: { themeId: string }, optional?: Record<string, never>): Theme;
    checkThemeWrite(required: { theme: Theme; relativePath: string }, optional?: Record<string, never>): void;
    writeThemeFile(required: { theme: Theme; relativePath: string; bytes: Buffer }, optional?: Record<string, never>): void;
    reloadTheme(required: { theme: Theme; themeId: string }, optional?: Record<string, never>): Theme;
  };
  media: {
    validateBytes: MediaImportSourcePorts["validateBytes"];
    persist(required: { input: MediaToolUploadInput; sourceUrl: string; actorId: string }, optional?: Record<string, never>): Promise<{ media: ImportedMediaView }>;
  };
  library: {
    saveDocument(required: { bytes: Uint8Array; name: string; principalId: string }, optional?: Record<string, never>): Promise<{ document: unknown }>;
  };
}

export type AssetWriteResult =
  | { written: string[]; skipped: string[]; notWritten: string[]; failed?: { path: string; reason: string } }
  | { written: string[]; skipped: string[]; media: ImportedMediaView[] }
  | { written: string[]; skipped: string[]; documents: unknown[] }
  | { written: string[]; skipped: string[]; status: unknown; errors: unknown };

export type AssetDestinationKit = {
  requireAssetDestination: typeof requireAssetDestination;
  prepareAssetWrites: typeof prepareAssetWrites;
  writeAssetFiles: typeof writeAssetFiles;
};

function isAssetDestinationKind(kind: string): kind is AssetDestination["kind"] {
  return kind === "site" || kind === "theme" || kind === "media" || kind === "library" || kind === "picked";
}

/** Authorize the destination before reading sources. @throws ToolInputError or permission refusal.
 * @complexity O(1). @example await requireAssetDestination({ deps, ctx, input: { kind: 'theme', themeId: 'basic' } }); */
export async function requireAssetDestination<Theme extends AssetTheme>({ deps, ctx, input }: { deps: AssetDestinationDeps<Theme>; ctx: ToolExecutionContext; input: unknown }, _optional: Record<string, never> = {}): Promise<AssetDestination> {
  if (input === undefined) throw new ToolInputError({ message: "A write needs destination.kind: site, theme, media, library or picked" });
  const value = requireInputRecord({ input });
  deps.refuseUnexpectedKeys(value, ["kind", "themeId", "path"]);
  const kind = requireString({ input: value, key: "kind" });
  if (!isAssetDestinationKind(kind)) throw new ToolInputError({ message: "destination.kind must be site, theme, media, library or picked" });
  const destination: AssetDestination = kind === "theme" ? { kind, themeId: requireString({ input: value, key: "themeId" }) } : { kind };
  const themeId = destination.kind === "theme" ? destination.themeId : undefined;
  const entityKind = kind === "library" ? "media" : kind;
  await requireToolPermission({ authorize: deps.authorize, workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: deps.permissions[kind] }, { entityType: entityKind === "picked" ? "fs-root" : entityKind, entityId: themeId ?? entityKind });
  return destination;
}

/** Decide collisions against disk AND earlier entries; rename uses the existing file-name owner.
 * No writes occur. Bounded to 1000 suffix probes rather than an unbounded directory scan. */
function choosePath<Theme extends AssetTheme>({ deps, folder, path, policy, reserved }: { deps: AssetDestinationDeps<Theme>; folder: string; path: string; policy: OverwritePolicy; reserved: Set<string> }): string | undefined {
  let candidate = path;
  const occupiedPaths = new Set<string>();
  for (let attempt = 0; attempt < 1000; attempt++) {
    const alreadyInBatch = reserved.has(candidate.toLowerCase());
    if (alreadyInBatch && policy === "overwrite") throw new ToolInputError({ message: `${candidate}: duplicate destination in this batch` });
    const occupied = deps.fs.inspect({ folder, path: candidate }, {}).overwrite || alreadyInBatch;
    if (!occupied || policy === "overwrite") { reserved.add(candidate.toLowerCase()); return candidate; }
    if (policy === "skip") return undefined;
    occupiedPaths.add(candidate);
    candidate = deps.fs.chooseNextName({ desiredPath: path, existingPaths: occupiedPaths }, {});
  }
  throw new ToolInputError({ message: `${path}: too many filename collisions` });
}

/** Per-destination checks that need no write: theme scope/containment, media file name and type. */
function checkFile<Theme extends AssetTheme>({ deps, destination, path, bytes }: { deps: AssetDestinationDeps<Theme>; destination: AssetDestination; path: string; bytes: Buffer }): void {
  if (destination.kind === "theme") {
    const theme = deps.theme.findTheme({ themeId: destination.themeId }, {});
    deps.theme.checkThemeWrite({ theme, relativePath: path }, {});
  }
  if (destination.kind !== "media") return;
  if (path !== basename(path)) throw new ToolInputError({ message: "Media destinations use a filename, not a folder path" });
  deps.media.validateBytes({ source: path, bytes, bytesTruncated: false }, {});
}

/** Validate the whole batch before persistence. Media are always new imports (the importer names
 * and dedups them), so `policy` applies to site and theme paths; picked writes show overwrites on
 * the card. @returns Frozen bytes/paths and the approval batch for site/picked writes; no writes.
 * @throws Existing writer/input errors. @complexity O(files × path depth), bounded collision probes. */
export function prepareAssetWrites<Theme extends AssetTheme>({ deps, destination, files, policy = "overwrite" }: { deps: AssetDestinationDeps<Theme>; destination: AssetDestination; files: AssetFile<Buffer>[]; policy?: OverwritePolicy }, _optional: Record<string, never> = {}): PreparedAssets<Buffer> {
  const prepared: PreparedAssets<Buffer> = { destination, files: [], skipped: [] };
  let folder: string | undefined;
  if (destination.kind === "site") folder = deps.fs.siteFolder({}, {});
  if (destination.kind === "theme") {
    folder = deps.theme.findTheme({ themeId: destination.themeId }, {}).dir;
  }
  const reserved = new Set<string>();
  for (const file of files) {
    const path = folder ? choosePath({ deps, folder, path: file.path, policy, reserved }) : file.path;
    if (path === undefined) { prepared.skipped.push(file.path); continue; }
    checkFile({ deps, destination, path, bytes: file.bytes });
    prepared.files.push({ ...file, path });
  }
  const batch = approvalBatch({ deps, destination, files: prepared.files });
  return { ...prepared, ...(batch === undefined ? {} : { batch }) };
}

/** Site and picked-folder writes become one fs_write_files batch (and its card); others need none. */
function approvalBatch<Theme extends AssetTheme>({ deps, destination, files }: { deps: AssetDestinationDeps<Theme>; destination: AssetDestination; files: AssetFile<Buffer>[] }): PreparedAssetBatch<Buffer> | undefined {
  const encoded = files.map(({ path, bytes }) => ({ path, content: bytes.toString("base64"), encoding: "base64" as const }));
  if (!encoded.length) return undefined;
  if (destination.kind === "picked") return deps.fs.preparePicked({ files: encoded }, {});
  const folder = deps.fs.siteFolder({}, {});
  return destination.kind === "site" ? deps.fs.prepareSite({ folder, files: encoded }, {}) : undefined;
}

/** Execute prepared writes via the owning writers. Partial failures remain visible to callers.
 * @returns Written/skipped paths and media or theme status. @throws Storage failures.
 * @complexity O(total bytes), sequential output I/O.
 * @example await writeAssetFiles({ deps, ctx, prepared }); */
export async function writeAssetFiles<Theme extends AssetTheme>({ deps, ctx, prepared }: { deps: AssetDestinationDeps<Theme>; ctx: ToolExecutionContext; prepared: PreparedAssets<Buffer> }, _optional: Record<string, never> = {}): Promise<AssetWriteResult> {
  const { destination, files, skipped, batch } = prepared;
  if (batch) return { ...deps.fs.writePrepared({ ...batch }, {}), skipped };
  if (destination.kind === "library") return writeLibraryFiles({ deps, ctx, files, skipped });
  if (destination.kind === "media") {
    const media = [];
    for (const file of files) {
      const contentType = deps.media.validateBytes({ source: file.path, bytes: file.bytes, bytesTruncated: false }, {});
      media.push((await deps.media.persist({ actorId: ctx.principal.id, sourceUrl: file.sourceUrl ?? "", input: { workspaceId: deps.workspaceId, bytes: file.bytes, filename: file.path, contentType, createdByPrincipal: ctx.principal.id } }, {})).media);
    }
    return { written: files.map(({ path }) => path), skipped, media };
  }
  const themeId = destination.kind === "theme" ? destination.themeId : undefined;
  if (themeId === undefined) throw new ToolInputError({ message: "Theme asset destination has no theme ID" });
  const theme = deps.theme.findTheme({ themeId }, {});
  for (const file of files) deps.theme.writeThemeFile({ theme, relativePath: file.path, bytes: file.bytes }, {});
  const reloaded = files.length ? deps.theme.reloadTheme({ theme, themeId }, {}) : theme;
  return { written: files.map(({ path }) => path), skipped, status: reloaded.status, errors: reloaded.errors };
}

/** Copy saves use the attachment tool's host adapter, including its error/analytics contract.
 * All documents were preflighted before this sequential persistence; storage faults propagate.
 * @complexity O(total bytes) time, O(files) result metadata; at most 50 files/25 MiB. */
async function writeLibraryFiles<Theme extends AssetTheme>({ deps, ctx, files, skipped }: { deps: AssetDestinationDeps<Theme>; ctx: ToolExecutionContext; files: AssetFile<Buffer>[]; skipped: string[] }, _options = {}) {
  const documents = [];
  for (const file of files) documents.push((await deps.library.saveDocument({ bytes: file.bytes, name: file.path, principalId: ctx.principal.id }, {})).document);
  return { written: files.map(({ path }) => path), skipped, documents };
}

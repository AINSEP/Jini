import { basename } from "node:path";
import { toolMetadata } from '@jini-ai/core/tool-metadata/fs-files';
import { ToolInputError, buildDomainRegistrations, indexCatalogById, optionalBoolean, optionalNumber, optionalString, requireInputRecord, requireString, withSchemaOnRejection, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";

import type { ToolContributor } from "@jini-ai/core";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";

import {
  FS_LIST_FILES_TOOL_ID,
  FS_READ_FILE_TOOL_ID,
  FS_WRITE_FILES_TOOL_ID,
} from "./agent-tools.js";
import { FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION } from "@jini-ai/cms/fs-files/custom-root-permission";
import { FsWriteInputError, prepareFileWrites, requirePickedFolder, type writePreparedFiles, type PreparedFileWrite } from "@jini-ai/cms/fs-files/write-files";

/**
 * @file Wires `fs_list_files`/`fs_read_file` into the assistant's tool catalog, through the same
 * `buildDomainRegistrations` gate and `registerToolContributor` seam every other first-party domain
 * uses (`theme/tool-registrations.ts`, `site-evidence/tool-registrations.ts`).
 *
 * Authorization shape: neither `fs-files.ts` nor `layout.ts` accepts an `authorize` dependency — like
 * `theme-files.ts`, they are pure discovery/filesystem functions with no notion of a principal, so
 * both handlers below call `requireToolPermission` inline, ADR-021 §2's single evaluator located at
 * the handler rather than inside the domain function.
 *
 * No live-state coupling: unlike `theme_write_file`, nothing here replaces an in-memory `routeDeps`
 * entry — both read handlers are pure reads, and `fs_write_files` (owner 2026-10-27) only writes
 * files into the picked folder after the human approves the exact batch on one card.
 */


export interface FsFilesToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  siteBinding: { readonly dir: string };
  resolveRoots?: () => Record<string, string | undefined>;
  resolveFsRoots(input: { siteDir: string; workspaceId: string }): Record<string, string | undefined>;
  resolveSiteFileRequest(input: { routeDeps: FsFilesToolDeps; root: string; relativePath?: string }, optional: Record<string, never>): { rootPath: string; relativePath: string };
  resolveFsFilePath(input: { rootPath: string; relativePath: string }): string;
  listFsFiles(input: { rootPath: string; relativePath: string; depth: number; limit: number; cursor?: string }): { files: string[]; truncated: boolean; nextCursor?: string; remaining?: number; message?: string };
  readFsFile(input: { rootPath: string; relativePath: string }): { content: string; bytes: number };
  isShapeRejection(input: { error: unknown }): boolean;
  rootIds: readonly string[]; readPermission: string; catalog: readonly import('@jini-ai/core').AgentToolDefinition[];
  surfaces: AssistantSurfaceDeps;
  approvalToolHandler: import('../asset-transfer/copy-tool.js').AssetApprovalToolHandler;
  refuseUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[]): void;
  writePreparedFiles: typeof writePreparedFiles;
}

/** Raw exported handlers can bypass schema normalization; keep this execution guard.
 * Filesystem tools cannot retarget another site's binding, even through a delegated call.
 * O(1); throws a caller-correctable rejection before any filesystem access.
 */
function requireCurrentSite({ input }: { input: Record<string, unknown> }, _optional = {}): void {
  if (input.site !== undefined) throw new ToolInputError({ message: 'Filesystem tools use only the active site; a site selector is not accepted' });
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually does.
 * See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own `sideEffects`
 * declaration.
 */
export const fsFilesDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> listFsFiles(): a bounded readdir walk under one allowed root, no writes.
  [FS_LIST_FILES_TOOL_ID, "none"],
  // -> readFsFile(): one readFileSync under one allowed root, no writes.
  [FS_READ_FILE_TOOL_ID, "none"],
  // -> writePreparedFiles(): creates or replaces files in the picked folder after one approval.
  [FS_WRITE_FILES_TOOL_ID, "mutates-durable-state"],
]);

/** Require the caller to choose a filesystem scope; never guess a root from an empty call.
 * @returns The supplied non-empty root, for the existing resolver and authorization gate.
 * @throws ToolInputError with the allowed roots and a complete listing example.
 * @complexity O(1), no effects.
 */
function requireFsRootInput({ input, toolId, FS_ROOT_IDS }: { input: Record<string, unknown>; toolId: string; FS_ROOT_IDS: readonly string[] }, _options = {}): string {
  if (typeof input.root !== "string" || input.root.length === 0) {
    throw new ToolInputError({ message: `${toolId}: 'root' (non-empty string) is required. Choose one of: ${FS_ROOT_IDS.join(", ")}. Example: fs_list_files({"root":"site"}); fs_read_file({"root":"site","path":"README.md"}).` });
  }
  return input.root;
}

/** `find` has no equivalent in this full-file reader: explain how to read the text instead.
 * @throws ToolInputError before policy or filesystem I/O when find is supplied.
 * @complexity O(1); returns the caller input unchanged when no correction is needed.
 */
function normalizeFsReadInput({ input }: { input: Record<string, unknown> }, _options = {}) {
  if (Object.hasOwn(input, "find")) {
    throw new ToolInputError({ message: `Unknown input 'find'. Accepted properties: root, path (both required); also site if listed in this tool's input schema. fs_read_file returns full file content and has no text-search parameter. Send fs_read_file({"root":"site","path":"README.md"}) and search the returned content.` });
  }
  return { input, notes: [] };
}

export interface PreparedWriteBatch { readonly folder: string; readonly writes: readonly PreparedFileWrite[] }

const kb = ({ bytes }: { bytes: number }, _optional = {}) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** The existing approval card, one per batch: a line per file (new/overwrite, size, path) and the
 * total. No `rememberKey`, so no "always allow" — every batch gets its own card. O(n) in files.
 * `toolId` binds the card's answer to the calling tool (`image_transform`/`files_copy` reuse this card). */
export function describeWriteBatch({ folder, writes }: PreparedWriteBatch, { toolId = FS_WRITE_FILES_TOOL_ID }: { toolId?: string } = {}): HumanConfirmSpec {
  const overwrites = writes.filter((write) => write.overwrite).length;
  const total = writes.reduce((sum, write) => sum + write.bytes.length, 0);
  const lines = writes.map((write) => `${write.overwrite ? "overwrite" : "new      "}  ${kb({ bytes: write.bytes.length }).padStart(9)}  ${write.path}`);
  return { toolId, errorCode: "FS_WRITE", title: `Write ${writes.length} file(s) to ${basename(folder)}?`,
    details: [{ label: "Folder", value: folder }, { label: "Files", value: lines.join("\n"), format: "code" }, { label: "Total", value: kb({ bytes: total }) }],
    ...(overwrites > 0 ? { warning: `Replaces ${overwrites} existing file(s). There is no undo.`, danger: true } : {}),
    confirmLabel: "Write files" };
}

/** The picked folder's real path under the write rule; `files_copy`/`image_transform` read it through
 * the same rule. @throws {FsWriteInputError} No folder or an unsafe folder. @complexity O(1) fs calls. */
export function resolvePickedFolder({ routeDeps }: { routeDeps: Pick<FsFilesToolDeps, "resolveRoots" | "resolveFsRoots" | "siteBinding" | "workspaceId"> }, _optional = {}): string {
  const { resolveFsRoots } = routeDeps;
  const custom = (routeDeps.resolveRoots ?? (() => resolveFsRoots({ siteDir: routeDeps.siteBinding.dir, workspaceId: routeDeps.workspaceId })))().custom;
  if (custom === undefined) throw new FsWriteInputError({ message: "No folder is picked — ask the person to pick one with the composer's folder button" });
  return requirePickedFolder({ dir: custom, siteDir: routeDeps.siteBinding.dir });
}

/** Resolves the picked folder and validates one batch before its card; nothing is written.
 * Shared with `image_transform`, so both write through one folder rule and one card.
 * @throws {ToolInputError} No folder, an unsafe folder, or a refused file. @complexity O(n·depth). */
export function preparePickedFolderBatch({ routeDeps, files }: { routeDeps: Pick<FsFilesToolDeps, "resolveRoots" | "resolveFsRoots" | "siteBinding" | "workspaceId" | "resolveFsFilePath">; files: unknown }, _optional = {}): PreparedWriteBatch {
  try {
    const folder = resolvePickedFolder({ routeDeps });
    return { folder, writes: prepareFileWrites({ folder, files, resolveFsFilePath: routeDeps.resolveFsFilePath }) };
  } catch (error) {
    throw error instanceof FsWriteInputError ? new ToolInputError({ message: error.message }) : error;
  }
}

async function listFilesTool(required: { routeDeps: FsFilesToolDeps; ctx: ToolExecutionContext }, _optional = {}): Promise<unknown> {
  const { routeDeps, ctx } = required;
  const { resolveSiteFileRequest, listFsFiles, isShapeRejection, readPermission: FS_FILES_READ_PERMISSION } = routeDeps;
  const CATALOG_BY_ID = indexCatalogById({ catalog: routeDeps.catalog });
  const input = requireInputRecord({ input: ctx.input });
  requireCurrentSite({ input }, {});
  const root = requireFsRootInput({ input, toolId: FS_LIST_FILES_TOOL_ID, FS_ROOT_IDS: routeDeps.rootIds });
  const relativePath = optionalString({ input: input, key: "path" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: FS_FILES_READ_PERMISSION }, { entityType: "fs-root", entityId: root });

  return withSchemaOnRejection({ toolId: FS_LIST_FILES_TOOL_ID, catalog: CATALOG_BY_ID, isShapeRejection: ({ error }) => isShapeRejection({ error }), fn: async () => {
    const fileRequest = resolveSiteFileRequest({ routeDeps, root, ...(relativePath === undefined ? {} : { relativePath }) }, {});
    // `truncated` is forwarded rather than dropped: `listFsFiles` stops at its own bounds, and a
    // caller handed only a short array cannot tell a small directory from a cut-off listing —
    // which is exactly the wrong thing for a model about to conclude "that file does not exist".
    const recursive = optionalBoolean({ input, key: "recursive" });
    const depth = optionalNumber({ input, key: "depth" }) ?? (recursive ? 12 : 1);
    const limit = optionalNumber({ input, key: "limit" }) ?? 100;
    const cursor = optionalString({ input, key: "cursor" });
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ToolInputError({ message: "limit must be an integer between 1 and 100" });
    const listing = listFsFiles({ ...fileRequest, depth, limit, ...(cursor === undefined ? {} : { cursor }) });
    return { root, path: relativePath ?? "", ...listing };
  } });
}

async function readFileTool(required: { routeDeps: FsFilesToolDeps; ctx: ToolExecutionContext }, _optional = {}): Promise<unknown> {
  const { routeDeps, ctx } = required;
  const { resolveSiteFileRequest, readFsFile, isShapeRejection, readPermission: FS_FILES_READ_PERMISSION } = routeDeps;
  const CATALOG_BY_ID = indexCatalogById({ catalog: routeDeps.catalog });
  const input = requireInputRecord({ input: ctx.input });
  requireCurrentSite({ input }, {});
  const root = requireFsRootInput({ input, toolId: FS_READ_FILE_TOOL_ID, FS_ROOT_IDS: routeDeps.rootIds });
  const relativePath = requireString({ input: input, key: "path" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: FS_FILES_READ_PERMISSION }, { entityType: "fs-root", entityId: root });

  return withSchemaOnRejection({ toolId: FS_READ_FILE_TOOL_ID, catalog: CATALOG_BY_ID, isShapeRejection: ({ error }) => isShapeRejection({ error }), fn: async () => {
    const fileRequest = resolveSiteFileRequest({ routeDeps, root, relativePath }, {});
    const { content, bytes } = readFsFile(fileRequest);
    return { root, path: relativePath, content, bytes };
  } });
}

export function buildFsFilesRegistrations(
  routeDeps: FsFilesToolDeps,
  _optional = {},
): ToolRegistration[] {
  const { surfaces, approvalToolHandler, refuseUnexpectedKeys, writePreparedFiles, resolveFsFilePath } = routeDeps;
  const CATALOG_BY_ID = indexCatalogById({ catalog: routeDeps.catalog });
  const handlers: Record<string, ToolHandler> = {
    [FS_LIST_FILES_TOOL_ID]: (ctx) => listFilesTool({ routeDeps, ctx }),

    [FS_READ_FILE_TOOL_ID]: (ctx) => readFileTool({ routeDeps, ctx }),

    [FS_WRITE_FILES_TOOL_ID]: approvalToolHandler<PreparedWriteBatch>({ surfaces,
      prepare: async ({ ctx }) => {
        const input = requireInputRecord({ input: ctx.input });
        refuseUnexpectedKeys(input, ["files"]);
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId,
          principalId: ctx.principal.id, permission: FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION }, { entityType: "fs-root", entityId: "custom" });
        return preparePickedFolderBatch({ routeDeps, files: input.files });
      },
      describe: ({ prepared }) => describeWriteBatch(prepared),
      run: async ({ prepared }) => {
        const outcome = writePreparedFiles({ ...prepared, resolveFsFilePath });
        return { applied: outcome.failed === undefined, ...outcome };
      },
    }, { flag: "applied" }),
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "fs-files",
    catalogModule: "@jini-ai/cms/fs-files/agent-tools",
    catalog: CATALOG_BY_ID,
    handlers,
    inputNormalizers: { [FS_READ_FILE_TOOL_ID]: normalizeFsReadInput },
    derivedRisk: fsFilesDerivedRisk,
  });
}

/**
 * Contributes the `fs-files` domain's AI tools to the assistant's catalog — called once by
 * `server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not
 * by importing this module.
 */
export function contributeFsFilesTools(): ToolContributor<FsFilesToolDeps, AssistantSurfaceDeps> {
  return { domain: "fs-files", build: buildFsFilesRegistrations, risk: fsFilesDerivedRisk };
}

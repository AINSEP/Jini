import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeSkills, rejectSkillNotFound, skillToolIdParam, type SkillRoutePrincipal, type SkillToolSourcesLoadFn } from "./shared.js";

/** One file of a skill package, in the plugin files response shape. */
export interface SkillPackageFile {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly content: string | null;
  readonly omitted: string | null;
}

/** The shared package reader's caps, echoed so the client can explain a truncated listing. */
export interface SkillPackageFileLimits {
  readonly maxFiles: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

/**
 * Reads one installed skill's folder (`directory` relative to the workspace's skill container).
 * Injected: the host's Node package reader enforces realpath containment, no symlink following and
 * the same count/byte caps as Plugins.
 */
export type SkillFilesReadFn = (required: { directory: string }) => Promise<{ files: readonly SkillPackageFile[]; truncated: boolean }>;

/** The deps this route reads. */
export interface SkillFilesRouteDeps {
  workspaceId: string;
  loadSkillSources: SkillToolSourcesLoadFn;
  readSkillFiles: SkillFilesReadFn;
  fileLimits: SkillPackageFileLimits;
  /** The host's per-skill install record file name, hidden from the listing. */
  installRecordFileName: string;
}

/** The files envelope, the same shape the plugin files route answers. */
export interface SkillFilesEnvelope {
  toolId: string;
  files: SkillPackageFile[];
  truncated: boolean;
  limits: SkillPackageFileLimits;
}

/** The last path segment of a reader-relative path (posix, never a trailing slash). @complexity O(n). */
function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

/**
 * GET one skill's files — the read-only sibling of plugin files: resolve an installed id before
 * joining any path. Disabled skills are listed too (inspecting a skill is how one decides to enable it).
 */
export const skillFilesRoute = defineJsonRoute<{ toolId: string }, SkillFilesEnvelope, SkillFilesRouteDeps, SkillRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/skills/:toolId/files",
  parse: (raw) => ok({ value: { toolId: skillToolIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSkills({ authorize });
    const sources = await deps.loadSkillSources({ includeDisabled: true });
    const skill = sources.find((source) => source.id === input.toolId);
    if (!skill?.directory) rejectSkillNotFound();
    // The directory comes from discovery, never request text. The shared reader enforces
    // realpath containment, no symlink following, and the same count/byte caps as Plugins.
    const { files, truncated } = await deps.readSkillFiles({ directory: skill.directory });
    // Install records are server bookkeeping, including copies in nested skill folders.
    const visibleFiles = files.filter((file) => fileName(file.relativePath) !== deps.installRecordFileName);
    return ok({ value: { toolId: input.toolId, files: visibleFiles, truncated, limits: deps.fileLimits } });
  },
});

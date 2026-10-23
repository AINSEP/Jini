import type { GitHubSkillSource } from "./github.js";
import type { SkillUploadFile } from "./validation.js";

/** The adapter uses failsafe YAML and rejects duplicate keys; the installer never parses YAML itself. */
export interface YamlReaderPort { read(required: { yaml: string }): unknown }

/** Layout is host-owned. Staging and workspace roots must share a rename-capable filesystem. */
export interface SkillLayoutPort {
  resolve(required: { workspaceId: string }): { workspaceRoot: string; stagingRoot: string; stateFileName: string };
}
export interface SkillFilesystemPort {
  mkdir(required: { path: string }): Promise<void>;
  mkdtemp(required: { prefix: string }): Promise<string>;
  writeFile(required: { path: string; bytes: Uint8Array; mode: number; exclusive: true }): Promise<void>;
  readFile(required: { path: string; maxBytes: number }): Promise<Uint8Array>;
  lstat(required: { path: string }): Promise<{ kind: "file" | "directory" | "symlink" | "other"; size: number }>;
  rename(required: { from: string; to: string }): Promise<void>;
  remove(required: { path: string }, optional?: { recursive?: boolean; force?: boolean }): Promise<void>;
}
/** Compatibility name used by the original node adapter and copied contract tests. */
export type FilesystemPort = SkillFilesystemPort;
/** Adapters must expose lstat semantics: symlinks are never classified as regular files/directories. */
export interface SkillToolSource {
  id: string;
  skillName: string;
  description: string;
  directory: string;
}
export interface ToolSourceLoaderPort {
  load(required: { workspaceId: string }, optional?: { includeDisabled?: boolean }): Promise<readonly SkillToolSource[]>;
}
export interface ArchiveEntry {
  path: string;
  kind: "file" | "directory" | "other";
  size: number;
  /** Closing/returning the iterator must release the entry stream, including early refusal. */
  read(required: Record<string, never>): AsyncIterable<Uint8Array>;
}
/** ZIP adapter must use strict names, validate sizes, and expose lazy entries without extraction. */
export interface ArchiveReaderPort {
  open(required: { bytes: Uint8Array }): Promise<{
    entries: AsyncIterable<ArchiveEntry>;
    close(required: Record<string, never>): void;
  }>;
}
/** HTTP transport follows the argument-object convention; hosts own credentials and networking. */
export type SkillFetchPort = (required: { url: string }, optional?: RequestInit) => Promise<Response>;
/** Provider-owned remote fetching. Hosts enforce deadlines, byte caps and source-origin policy.
 * Returned files still pass through the installer's shared validator before any filesystem writes.
 */
export type SkillSourceFetchPort<Source extends object = object> = (
  required: { url: string }, optional?: Record<string, never>,
) => Promise<{ readonly files: readonly SkillUploadFile[]; readonly source: Source }>;
/** Pure, fail-closed check of provider-owned JSON provenance; never authorizes an installation. */
export type SkillSourceValidatorPort = (required: { source: unknown }, optional?: Record<string, never>) => boolean;

export interface SkillInstallDeps<Source extends object = GitHubSkillSource> {
  layout: SkillLayoutPort;
  filesystem: SkillFilesystemPort;
  archiveReader: ArchiveReaderPort;
  yamlReader: YamlReaderPort;
  /** @deprecated Supply fetchSource and validateSource instead. Used only for legacy githubUrl input. */
  fetch?: SkillFetchPort;
  fetchSource?: SkillSourceFetchPort<Source>;
  validateSource?: SkillSourceValidatorPort;
  ids: { next(required: Record<string, never>): string };
  toolId: (required: { name: string }) => string;
  toolSourceLoader: ToolSourceLoaderPort;
}

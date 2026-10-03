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
export interface SkillInstallDeps {
  layout: SkillLayoutPort;
  filesystem: SkillFilesystemPort;
  archiveReader: ArchiveReaderPort;
  yamlReader: YamlReaderPort;
  fetch: SkillFetchPort;
  ids: { next(required: Record<string, never>): string };
  toolId: (required: { name: string }) => string;
  toolSourceLoader: ToolSourceLoaderPort;
}

export interface FileInfo { kind: 'file' | 'directory' | 'other'; mtimeMs: number; diskBytes: number }
/** lstat semantics for stat; copy may dereference package symlinks as explicitly requested. */
export interface PackagingFilesystemPort {
  exists(required: { path: string }): boolean;
  read(required: { path: string }): Uint8Array;
  /** Required for npm staging: read at most maxBytes from offset zero, never the whole file.
   * Optional so adapters used only for other packaging operations keep their existing shape. */
  readPrefix?(required: { path: string; maxBytes: number }): Uint8Array;
  stat(required: { path: string }): FileInfo;
  entries(required: { path: string }): readonly string[];
  realpath(required: { path: string }): string;
  copy(required: { from: string; to: string }, optional?: { dropNestedModules?: boolean; exclude?: (required: { path: string; directory: boolean }) => boolean }): void;
  remove(required: { path: string }): void;
}
export interface PackageResolverPort { resolve(required: { fromDirectory: string; packageName: string }): string | undefined }
export interface ProcessRunnerPort { run(required: { command: string; args: readonly string[]; cwd: string; shell: boolean }): { stdout: string; exitCode: number } }
export interface AsarHeaderNode { files?: Record<string, AsarHeaderNode>; link?: string; size?: number; offset?: string }
export interface ArchiveReaderPort {
  header(required: { archivePath: string }): { files?: Record<string, AsarHeaderNode> };
  read(required: { archivePath: string; entryPath: string }): Uint8Array;
}
/** Must parse static imports, re-exports and literal dynamic imports using an AST, ignoring comments. */
export interface ImportReaderPort { imports(required: { file: string; source: string }): readonly string[] }
export interface ImportAliasPort { resolve(required: { specifier: string; fromFile: string; distDir: string }): string | undefined }
/** Bind to scripts/lib/pack-jini-packages.ts buildAndPackClosure in the host, not inside a package. */
export interface WorkspacePackagePackerPort {
  pack(required: { repoRoot: string; packagesDir: string; rootNames: readonly string[]; destDir: string }): {
    readonly closure: readonly string[]; readonly tarballPathByName: ReadonlyMap<string, string>;
  };
}
export interface SnapshotPort { snapshot(required: { roots: readonly string[] }): ReadonlyMap<string, string> }
export interface SleepPort { sleep(required: { milliseconds: number }): Promise<void> }

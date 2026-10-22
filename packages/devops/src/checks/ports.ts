/** A shell-free executable request. Paths and executables belong to the host. */
export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** Null means the executable could not complete, including signals and spawn failures. */
export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunnerPort {
  run(args: ProcessRequest): Promise<ProcessResult>;
}

export interface SourceReaderPort {
  readText(args: { path: string }): string;
}

/** Synchronous filesystem operations; createDirectory must fail when the path already exists. */
export interface FilesystemPort extends SourceReaderPort {
  exists(args: { path: string }): boolean;
  isSymbolicLink(args: { path: string }): boolean;
  readDirectory(args: { path: string }): readonly string[];
  writeText(args: { path: string; text: string }): void;
  createTempDirectory(args: { parent: string; prefix: string }): string;
  createDirectory(args: { path: string }): void;
  ensureDirectory(args: { path: string }): void;
  copyDirectory(args: { source: string; destination: string }): void;
  removeDirectory(args: { path: string }): void;
}

export interface PackageInstallerPort {
  /** Install the manifest already written in directory; return captured output, never exit. */
  install(args: { directory: string }): Promise<ProcessResult>;
}

export interface CheckLoggerPort {
  log(args: { projectKey: string; status: string; message: string }): void;
}

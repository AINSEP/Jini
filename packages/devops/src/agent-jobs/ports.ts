export interface AgentJob { readonly id: string; readonly prompt: string }
export interface AgentJobOptions {
  readonly repository: string;
  readonly executable: string;
  readonly model: string;
  readonly effort: string;
  readonly sandbox: 'read-only' | 'workspace-write';
  readonly addDirs: readonly string[];
  readonly concurrency: number;
  readonly dispatchPrefix: string;
  readonly outputDirectory: string;
}
export interface CodexInvocation {
  readonly executable: string; readonly cwd: string; readonly args: readonly string[]; readonly stdin: string;
}
/** Runner streams logs into the supplied files and resolves only after both logs are closed. */
export interface AgentCliRunnerPort {
  run(required: CodexInvocation & { jsonlPath: string; stderrPath: string }): Promise<{ exitCode: number | null }>;
}
export interface JobFilesystemPort {
  mkdir(required: { path: string }): Promise<void>;
  /** True only for a regular file, following symlinks; directories are not completed reports. */
  exists(required: { path: string }): Promise<boolean>;
  read(required: { path: string }): Promise<string>;
  write(required: { path: string; text: string }): Promise<void>;
  remove(required: { path: string }): Promise<void>;
}
export interface AgentEventDecoderPort { decode(required: { line: string }): unknown }
export type ParsedCodexRun = { success: true; finalMessage: string; usage: unknown } | { success: false; reason: string };
export interface AgentJobResult { id: string; status: 'skipped' | 'succeeded' | 'failed'; exitCode?: number | null; reason?: string }

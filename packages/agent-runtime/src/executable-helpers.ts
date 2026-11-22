import type { AgentRuntimeState } from './runtime-state.js';

export interface ResolvedExecutableOptions { env: NodeJS.ProcessEnv; state: AgentRuntimeState }
export interface ExecutableResolutionHelpers {
  executableFilePath(raw: string | undefined, options: ResolvedExecutableOptions): string | null;
  isRunnableFile(path: string, options: ResolvedExecutableOptions): boolean;
  searchPath(input: { bin: string }, options: ResolvedExecutableOptions): string | null;
  platformExecutableName(input: { name: string }): string;
  resourceRootOf(options: ResolvedExecutableOptions): string | undefined;
  resolveDetectionHome(options: ResolvedExecutableOptions): { home: string; hasOverride: boolean };
}

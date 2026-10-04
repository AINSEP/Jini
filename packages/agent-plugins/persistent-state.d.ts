export type PluginMemoryKind = 'learned' | 'notes';
export interface PluginStatePaths { root: string; packages: string; data: string; learned: string; notes: string; }
export const DEFAULT_PLUGIN_MEMORY_LIMITS: Readonly<{ learned: number; notes: number; files: number }>;
export interface PluginStateEffects {
  filesystem: Pick<typeof import('node:fs/promises'), 'mkdir' | 'rmdir' | 'readdir' | 'open' | 'readFile' | 'rename' | 'rm' | 'stat' | 'chmod' | 'realpath'>;
  contain(required: { root: string; entryPath: string }): Promise<string>;
  withLock<T>(required: { lockPath: string; run(): Promise<T> }): Promise<T>;
}
export interface PluginMemoryFile { relativePath: string; text: string; }
export interface PluginMemory {
  list(required: { kind: PluginMemoryKind }, optional?: {}): Promise<PluginMemoryFile[]>;
  read(required: { kind: PluginMemoryKind; entryPath: string }, optional?: {}): Promise<string>;
  writeNote(required: { entryPath: string; text: string }, optional?: {}): Promise<{ relativePath: string; bytes: number }>;
  learned: {
    read(required: { entryPath: string }, optional?: {}): Promise<string>;
    write(required: { entryPath: string; text: string }, optional?: {}): Promise<{ relativePath: string; bytes: number }>;
  };
}
export function pluginStatePaths(required: { workspaceRoot: string; pluginId: string }, optional?: {}): PluginStatePaths;
export function createPluginMemory(required: PluginStateEffects & { workspaceRoot: string; pluginId: string }, optional?: { limits?: Partial<typeof DEFAULT_PLUGIN_MEMORY_LIMITS> }): PluginMemory;
export function migratePluginLayout(required: PluginStateEffects & { workspaceRoot: string; parsePluginId(required: { value: unknown }): string; onEvent?(required: { event: string; message: string }): void }, optional?: {}): Promise<{ complete: boolean; moved: number }>;

export function assertPluginStatePath(required: Pick<PluginStateEffects, "filesystem" | "contain"> & { workspaceRoot: string; entryPath: string }, optional?: {}): Promise<string>;

export function withPluginStateLock<T>(required: PluginStateEffects & { workspaceRoot: string; pluginId: string; run(): Promise<T> }, optional?: {}): Promise<T>;

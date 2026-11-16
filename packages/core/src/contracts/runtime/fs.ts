import type { RuntimePlatform } from "./platform.js";

export interface AtomicWritePortOptions<Filesystem = never> {
  mode?: number; defaultMode?: number; refuseSymlink?: boolean; verifyOwnerOnly?: boolean; createParent?: boolean;
  platform?: RuntimePlatform; tempName?: (required: { filePath: string }) => string; tempPath?: (required: { filePath: string }) => string;
  fs?: Filesystem;
}

export interface AtomicFileWriterPort<Filesystem = never> {
  writeText(required: { filePath: string; content: string | Uint8Array }, optional?: AtomicWritePortOptions<Filesystem>): Promise<void>;
  writeJson(required: { filePath: string; data: unknown }, optional?: AtomicWritePortOptions<Filesystem> & { trailingNewline?: boolean }): Promise<void>;
  /** Preserve the original before a personal-config change; call under the destination's lock. */
  backupOriginalOnce(required: { filePath: string }, optional?: Record<string, never>): Promise<void>;
}

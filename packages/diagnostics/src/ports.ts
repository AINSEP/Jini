import type { Clock } from "@jini-ai/core/primitives";
import type { MachineInfo } from "./types.js";

/** Host effects used by bundle collection. Core functions never read ambient host state. */
export interface DiagnosticsFilesystemPort {
  /** Read the full file or a bounded trailing window without loading the full large file. */
  readFile(required: { absolutePath: string }, optional?: { tailBytes?: number | undefined }): Promise<Buffer>;
  readDirectory(required: { absolutePath: string }): Promise<Array<{ name: string; isDirectory: boolean }>>;
  stat(required: { absolutePath: string }): Promise<{ isFile: boolean; mtimeMs: number }>;
}

export interface DiagnosticsSystemPort {
  platform(required: Record<string, never>): string;
  machineInfo(required: Record<string, never>): Omit<MachineInfo, "username">;
}

export interface DiagnosticsArchivePort {
  file(required: { name: string; content: string }): void;
  generate(required: Record<string, never>): Promise<Buffer>;
}

export interface DiagnosticsArchiveFactoryPort {
  /** Every invocation returns a fresh archive so successive exports cannot share files. */
  create(required: Record<string, never>): DiagnosticsArchivePort;
}

export interface DiagnosticsPorts {
  filesystem: DiagnosticsFilesystemPort;
  clock: Clock;
  system: DiagnosticsSystemPort;
  archiveFactory: DiagnosticsArchiveFactoryPort;
}

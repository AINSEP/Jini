import type { Clock } from "@jini-ai/core/primitives";
import type { DiagnosticsSystemPort } from "./ports.js";

import type { CollectedFile, MachineInfo } from "./types.js";
export type { MachineInfo } from "./types.js";

export interface DiagnosticsAppInfo {
  name: string;
  version?: string | undefined;
  channel?: string | undefined;
  packaged?: boolean | undefined;
}

export interface DiagnosticsContext {
  app: DiagnosticsAppInfo;
  /** Identifies which surface triggered the export ("daemon-http", "desktop-ipc"). */
  source: string;
  /** Active runtime namespace, when known. */
  namespace?: string | undefined;
  /** Daemon URL or other endpoint that the UI was connected to. */
  endpoint?: string | undefined;
  /** Whether the host process could reach the daemon when triggering. */
  daemonReachable?: boolean | undefined;
  /** Free-form flags or notes. Will be JSON-stringified into the manifest. */
  extra?: Record<string, unknown> | undefined;
  /**
   * Upstream warnings to merge into the manifest's `warnings` array.
   * Useful when the host knows a category of data is unavailable (e.g.
   * file logs in non-sidecar launches) and wants to surface that fact
   * without producing fake "missing file" entries.
   */
  warnings?: string[] | undefined;
}

export interface DiagnosticsManifest {
  exportedAt: string;
  app: DiagnosticsAppInfo;
  source: string;
  namespace?: string | undefined;
  endpoint?: string | undefined;
  daemonReachable?: boolean | undefined;
  files: {
    name: string;
    absolutePath: string;
    bytes: number;
    error?: string | undefined;
  }[];
  warnings: string[];
  extra?: Record<string, unknown> | undefined;
}

/** Combines file and host warnings using only the caller's clock for the export timestamp. */
export function buildManifest(
  { context, files, clock }: { context: DiagnosticsContext; files: CollectedFile[]; clock: Clock },
): DiagnosticsManifest {
  const warnings: string[] = [...(context.warnings ?? [])];
  for (const file of files) {
    if (file.error) warnings.push(`${file.name}: ${file.error}`);
  }
  return {
    exportedAt: new Date(clock.nowMs()).toISOString(),
    app: context.app,
    source: context.source,
    namespace: context.namespace,
    endpoint: context.endpoint,
    daemonReachable: context.daemonReachable,
    files: files.map((file) => ({
      name: file.name,
      absolutePath: file.absolutePath,
      bytes: file.bytes,
      error: file.error,
    })),
    warnings,
    extra: context.extra,
  };
}

/** Reads the injected machine snapshot and adds the caller's optional username. */
export function buildMachineInfo(
  { system }: { system: DiagnosticsSystemPort },
  { username }: { username?: string | undefined } = {},
): MachineInfo {
  return { ...system.machineInfo({}), username };
}

/** Uses an explicit date override or the supplied clock; never reads the ambient clock. */
export function diagnosticsFileName(
  { prefix, clock }: { prefix: string; clock: Clock },
  { now }: { now?: Date } = {},
): string {
  const iso = (now ?? new Date(clock.nowMs())).toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  return `${prefix}-${iso}.zip`;
}

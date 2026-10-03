import type { Clock } from "@jini-ai/core/primitives";
import type { DiagnosticsFilesystemPort, DiagnosticsSystemPort } from "./ports.js";
import type { CollectedFile } from "./types.js";
export type { CollectedFile } from "./types.js";
import { join } from "node:path";

import { redactJsonText, redactText, type RedactionOptions } from "./redaction.js";

export type LogSourceKind = "json" | "text";

export interface LogSource {
  /** Relative path inside the export zip (forward-slash). */
  name: string;
  /** Absolute path on disk to read from. */
  absolutePath: string;
  /** Whether the file should be parsed/redacted as JSON or plain text. */
  kind: LogSourceKind;
  /** Optional max bytes to read from the file tail; omit for whole file. */
  tailBytes?: number;
}

/** Reads through the filesystem port and records read failures as unavailable entries. */
export async function collectLogSource(
  { source, filesystem }: { source: LogSource; filesystem: DiagnosticsFilesystemPort },
  opts: RedactionOptions = {},
): Promise<CollectedFile> {
  try {
    const buffer = await filesystem.readFile({ absolutePath: source.absolutePath }, { tailBytes: source.tailBytes });
    const text = buffer.toString("utf8");
    const bytes = buffer.byteLength;
    const redacted = source.kind === "json" ? redactJsonText({ text }, opts) : redactText({ text }, opts);
    return { name: source.name, absolutePath: source.absolutePath, content: redacted, bytes };
  } catch (error) {
    return {
      name: source.name,
      absolutePath: source.absolutePath,
      content: null,
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Collects in parallel while preserving the supplied source order, including failures. */
export async function collectLogSources(
  { sources, filesystem }: { sources: LogSource[]; filesystem: DiagnosticsFilesystemPort },
  opts: RedactionOptions = {},
): Promise<CollectedFile[]> {
  return await Promise.all(sources.map((source) => collectLogSource({ source, filesystem }, opts)));
}

const DEFAULT_CRASH_DIRS_DARWIN = [
  "/Library/Logs/DiagnosticReports",
];

export interface CrashReportLookup {
  /** Filenames must contain at least one of these substrings (case-insensitive). */
  matchSubstrings: string[];
}

export interface CrashReportOptions {
  /** Only include files modified within this many days. */
  withinDays?: number;
  /** Limit how many reports to include. */
  maxReports?: number;
  /** Override base directories to scan. */
  searchDirs?: string[];
  /** Home directory to derive ~/Library/Logs/DiagnosticReports from. */
  homeDir?: string;
}

/** Scans matching reports with an explicit platform, clock and filesystem. */
export async function findMacOSCrashReports(
  { matchSubstrings, filesystem, clock, system }: CrashReportLookup & { filesystem: DiagnosticsFilesystemPort; clock: Clock; system: DiagnosticsSystemPort },
  options: CrashReportOptions = {},
): Promise<LogSource[]> {
  if (system.platform({}) !== "darwin") return [];
  const within = (options.withinDays ?? 7) * 24 * 60 * 60 * 1000;
  const cutoff = clock.nowMs() - within;
  const max = options.maxReports ?? 20;
  const dirs = options.searchDirs ?? [
    ...(options.homeDir ? [join(options.homeDir, "Library/Logs/DiagnosticReports")] : []),
    ...DEFAULT_CRASH_DIRS_DARWIN,
  ];
  const matches = matchSubstrings.map((entry) => entry.toLowerCase());

  const found: { absolutePath: string; mtimeMs: number; name: string }[] = [];
  for (const dir of dirs) {
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = await filesystem.readDirectory({ absolutePath: dir });
    } catch {
      continue;
    }
    for (const { name: entry } of entries) {
      const lower = entry.toLowerCase();
      if (!matches.some((needle) => lower.includes(needle))) continue;
      const absolutePath = join(dir, entry);
      try {
        const info = await filesystem.stat({ absolutePath });
        if (!info.isFile) continue;
        if (info.mtimeMs < cutoff) continue;
        found.push({ absolutePath, mtimeMs: info.mtimeMs, name: entry });
      } catch {
        continue;
      }
    }
  }

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, max).map(({ absolutePath, name }) => ({
    name: `crash-reports/${name}`,
    absolutePath,
    kind: "text",
  }));
}

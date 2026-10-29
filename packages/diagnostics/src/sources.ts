import type { Clock } from "@jini-ai/core/primitives";
import type { DiagnosticsFilesystemPort, DiagnosticsSystemPort } from "./ports.js";
import type { CollectedFile } from "./types.js";
export type { CollectedFile } from "./types.js";
import { join } from "node:path";
import { readDirectorySafe, statSafe } from "./discovery-filesystem.js";

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

type CrashReportCandidate = { absolutePath: string; mtimeMs: number; name: string };

async function crashReportsInDirectory(
  { dir, matches, cutoff, filesystem }: {
    dir: string;
    matches: string[];
    cutoff: number;
    filesystem: DiagnosticsFilesystemPort;
  },
  _options: Record<string, never> = {},
): Promise<CrashReportCandidate[]> {
  const entries = await readDirectorySafe({ path: dir, filesystem });
  const found: CrashReportCandidate[] = [];
  const matching = entries.filter(({ name }) => matches.some((needle) => name.toLowerCase().includes(needle)));
  for (const { name: entry } of matching) {
    const absolutePath = join(dir, entry);
    const info = await statSafe({ path: absolutePath, filesystem });
    if (!info?.isFile || info.mtimeMs < cutoff) continue;
    found.push({ absolutePath, mtimeMs: info.mtimeMs, name: entry });
  }
  return found;
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

  const found: CrashReportCandidate[] = [];
  for (const dir of dirs) {
    const reports = await crashReportsInDirectory({ dir, matches, cutoff, filesystem });
    for (const report of reports) found.push(report);
  }

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, max).map(({ absolutePath, name }) => ({
    name: `crash-reports/${name}`,
    absolutePath,
    kind: "text",
  }));
}

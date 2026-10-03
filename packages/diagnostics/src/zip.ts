import type { DiagnosticsPorts } from "./ports.js";

import { redactJsonValue, type RedactionOptions } from "./redaction.js";
import { buildManifest, buildMachineInfo, type DiagnosticsContext, type DiagnosticsManifest, type MachineInfo } from "./manifest.js";
import { collectLogSources, findMacOSCrashReports, type CollectedFile, type CrashReportLookup, type CrashReportOptions, type LogSource } from "./sources.js";

const PLACEHOLDER_PREFIX = "; file unavailable: ";

export interface DiagnosticsExportInput extends DiagnosticsPorts {
  context: DiagnosticsContext;
  sources: LogSource[];
}

export interface DiagnosticsExportOptions {
  redaction?: RedactionOptions;
  /** When provided, scan macOS crash reports matching these substrings. */
  crashReports?: CrashReportLookup;
  crashReportOptions?: CrashReportOptions;
}

export interface DiagnosticsExportResult {
  zip: Buffer;
  manifest: DiagnosticsManifest;
  machineInfo: MachineInfo;
}

function placeholderForMissing(file: CollectedFile): string {
  // `collected` here always comes from this module's own collectLogSources()
  // call, whose sole null-content producer (collectLogSource's catch clause)
  // always sets `error` to a string — there's no runtime path in this file
  // that reaches here with `file.error` undefined, so no "unknown error"
  // fallback is needed.
  return `${PLACEHOLDER_PREFIX}${file.error}\n`;
}

/** Packages redacted files and summaries into a fresh host-provided archive. */
export async function buildDiagnosticsZip(
  input: DiagnosticsExportInput,
  options: DiagnosticsExportOptions = {},
): Promise<DiagnosticsExportResult> {
  const redaction = options.redaction ?? {};
  const sources = [...input.sources];

  if (options.crashReports != null) {
    const crashes = await findMacOSCrashReports({
      ...options.crashReports,
      filesystem: input.filesystem,
      clock: input.clock,
      system: input.system,
    }, options.crashReportOptions);
    sources.push(...crashes);
  }

  const collected = await collectLogSources({ sources, filesystem: input.filesystem }, redaction);
  const manifest = buildManifest({ context: input.context, files: collected, clock: input.clock });
  const machineInfo = buildMachineInfo({ system: input.system }, { username: redaction.username });

  const zip = input.archiveFactory.create({});
  for (const file of collected) {
    zip.file({ name: file.name, content: file.content ?? placeholderForMissing(file) });
  }
  zip.file({
    name: "summary/manifest.json",
    content: JSON.stringify(redactJsonValue({ value: manifest }, redaction), null, 2),
  });
  zip.file({
    name: "summary/machine-info.json",
    content: JSON.stringify(redactJsonValue({ value: machineInfo }, redaction), null, 2),
  });

  const buffer = await zip.generate({});

  return { zip: buffer, manifest, machineInfo };
}

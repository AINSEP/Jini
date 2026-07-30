/**
 * @module @jini-ai/diagnostics
 *
 * Diagnostics-bundle tooling shared by any host application's HTTP and desktop
 * export surfaces: endpoint constants, JSON/text secret redaction, log-source
 * collection (incl. macOS crash reports and coding-agent CLI logs), a manifest
 * builder, and a zip packager. See `source-map.md` for full provenance and
 * scope-decision notes (this package is NOT yet in extraction-plan.md's
 * locked §3 package set — see that file for details).
 */
export {
  DIAGNOSTICS_CONTENT_TYPE,
  DIAGNOSTICS_EXPORT_PATH,
  DIAGNOSTICS_FILENAME_PREFIX,
} from "./contract.js";

export {
  redactJsonValue,
  redactJsonText,
  redactText,
  type RedactionOptions,
} from "./redaction.js";

export {
  collectLogSource,
  collectLogSources,
  findMacOSCrashReports,
  type CollectedFile,
  type CrashReportLookup,
  type LogSource,
  type LogSourceKind,
} from "./sources.js";

export {
  buildManifest,
  buildMachineInfo,
  diagnosticsFileName,
  type DiagnosticsAppInfo,
  type DiagnosticsContext,
  type DiagnosticsManifest,
  type MachineInfo,
} from "./manifest.js";

export {
  buildDiagnosticsZip,
  type DiagnosticsExportInput,
  type DiagnosticsExportResult,
} from "./zip.js";

export {
  buildRunEventLogSources,
  buildAgentCliLogSources,
  type AgentCliLogOptions,
} from "./agent-logs.js";

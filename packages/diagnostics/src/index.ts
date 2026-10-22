/**
 * @module @jini-ai/diagnostics
 * Host HTTP/desktop diagnostic exports: redaction, log collection, manifest building and ZIPs.
 * Agent-CLI log integrations are optional and caller-parameterized. The AMR slot activates only
 * when its home/data directory is supplied. Whether this named CLI vocabulary should become a
 * generic {agent, dir} list remains an owner decision; it must not change silently during cleanup.
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
  type CrashReportOptions,
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
  type DiagnosticsExportOptions,
  type DiagnosticsExportResult,
} from "./zip.js";

export {
  buildRunEventLogSources,
  buildAgentCliLogSources,
  type AgentCliLogOptions,
} from "./agent-logs.js";

export { createNodeDiagnosticsPorts } from "./node-ports.js";
export type { DiagnosticsFilesystemPort, DiagnosticsSystemPort, DiagnosticsArchivePort, DiagnosticsArchiveFactoryPort, DiagnosticsPorts } from "./ports.js";

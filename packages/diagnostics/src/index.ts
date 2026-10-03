/**
 * @module @jini-ai/diagnostics
 *
 * Diagnostics-bundle tooling shared by any host application's HTTP and desktop
 * export surfaces: endpoint constants, JSON/text secret redaction, log-source
 * collection (incl. macOS crash reports and coding-agent CLI logs), a manifest
 * builder, and a zip packager. See `archived provenance ledger` for full provenance and
 * scope-decision notes (this package is NOT yet in extraction-plan.md's
 * locked §3 package set — see that file for details).

 * Archived provenance rationale:
 * ## Design decision: `agent-logs.ts` carries real agent-CLI vocabulary, ported anyway
 *
 * `r2-packages.md`'s coupling grade for this package ("LOW... daemon-endpoint
 * comments") was assessed at the whole-package level. Read in isolation,
 * `agent-logs.ts` carries more domain content than the other six files: it
 * hardcodes knowledge of four specific coding-agent CLIs — Claude Code, Codex,
 * OpenCode, and an "AMR"-style OpenCode runtime — including their default
 * config-home directory names (`.claude`, `.codex`, `opencode`) and env-var
 * override names (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_TEST_HOME`,
 * `XDG_DATA_HOME`). "AMR" itself is OD's own internal name for an agent
 * orchestration layer, not a generic term.
 *
 * This was ported anyway, deliberately, not dropped or trimmed, for three
 * reasons: (1) the task brief explicitly lists `agent-logs` as one of the
 * seven modules that make up "diagnostics-bundle tooling" and does not flag it
 * for exclusion the way Target 2's task brief explicitly excluded
 * `project-storage.ts`; (2) every one of these CLI integrations is optional
 * and caller-parameterized (`homeDir`/`claudeConfigDir`/`codexHome`/
 * `amrOpenCodeHome`/`xdgDataHome` are all inputs, not hardcoded paths the
 * function reaches for on its own) — a Jini-based product that drives the same
 * external agent CLIs (Claude Code, Codex, OpenCode are all plausible
 * `@jini/agent-runtime` targets per extraction-plan.md's roadmap) can reuse
 * this verbatim, and one that doesn't simply never calls
 * `buildAgentCliLogSources`; (3) the "AMR" agent slot is additive-only (only
 * appended to `agentDirs` when `amrOpenCodeHome`/`dataDir` is supplied) so a
 * non-OD consumer never sees it activate. Flagged here explicitly rather than
 * silently ported, per this porting session's own standard: a future
 * Coordinator/Software-Architect review of this not-yet-locked package should
 * weigh whether the Claude/Codex/OpenCode/AMR-specific vocabulary belongs in a
 * neutral diagnostics package or should be generalized further (e.g. a
 * caller-supplied list of `{agent, dir}` pairs instead of the four names being
 * baked into the function body). Not resolved here — this is exactly the kind
 * of judgment call flagged for sign-off, not a decision this task should make
 * unilaterally.
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

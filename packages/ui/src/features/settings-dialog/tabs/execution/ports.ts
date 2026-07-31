import type { ByokConfig, DetectedAgent } from './types.js';

/**
 * The host-specific transport this tab needs. Genuinely host-owned: the origin
 * called its own daemon's agent-scan and connection-test endpoints. This
 * feature ships only a fake in `dependencies.ts`; a real host supplies its own
 * implementation (same convention as `McpIntegrationsPort`).
 */
export interface ExecutionPort {
  /** Code-agent CLIs present on this machine. Called on mount and on rescan. */
  detectLocalAgents(): Promise<readonly DetectedAgent[]>;

  /** Probes the BYOK endpoint with the supplied credentials. Resolves with
   *  `ok: false` for a reachable-but-rejecting endpoint; rejects only for
   *  transport failures the tab should surface as an error. */
  testConnection(config: ByokConfig): Promise<{ ok: boolean; message?: string }>;

  /** Live model discovery. Optional — without it the model field falls back to
   *  the selected preset's `preferredModels` plus free text. */
  listModels?(config: ByokConfig): Promise<readonly string[]>;

  /** Re-runs the host's own agent detection (e.g. after the operator installs
   *  a CLI). Optional; without it the rescan button is not rendered. */
  rescanLocalAgents?(): Promise<readonly DetectedAgent[]>;
}

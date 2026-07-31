import type { ByokConfig, DetectedAgent } from './types.js';

/**
 * The host-specific transport this tab needs. Genuinely host-owned: the origin
 * called its own daemon's agent-scan and connection-test endpoints. This
 * feature ships only a fake in `dependencies.ts`; a real host supplies its own
 * implementation (same convention as `McpIntegrationsPort`).
 */
export interface ExecutionPort {
  /** Code-agent CLIs present on this machine. Called on mount and on rescan.
   *  REJECTS if detection itself fails (host process crashed, the host's
   *  transport to its own probing mechanism is down, etc.) — an empty
   *  resolved array means "detection ran and found nothing," a genuinely
   *  different state from "detection could not run." A host implementation
   *  must not collapse the two into the same `[]`. */
  detectLocalAgents(): Promise<readonly DetectedAgent[]>;

  /**
   * Probes the BYOK endpoint with the supplied credentials. Two distinct
   * outcomes, both documented per this package's error-reporting contract
   * (§3.1 — a domain-outcome exception to "ports reject"):
   *  - **Resolves** with `ok: false` when the endpoint was REACHED and it
   *    rejected the credentials/model — that rejection IS the answer to
   *    "does this connection work?", so it is a value, not a failure.
   *  - **Rejects** when the test itself could not run — a transport failure,
   *    timeout, or malformed base URL never got an answer FROM the provider
   *    at all, so there is nothing to report as a value.
   */
  testConnection(config: ByokConfig): Promise<{ ok: boolean; message?: string }>;

  /** Live model discovery. Optional — without it the model field falls back to
   *  the selected preset's `preferredModels` plus free text. REJECTS on any
   *  failure (auth, timeout, unreachable endpoint, unsupported protocol) —
   *  unlike `testConnection`, there is no legitimate "reachable but empty"
   *  answer worth treating as a value here: a provider genuinely reporting
   *  zero models is indistinguishable in practice from "the call to list
   *  them failed," so every non-crash outcome resolves either a real,
   *  non-empty list or rejects with why it couldn't. A host must not resolve
   *  `[]` to mean "the request failed." */
  listModels?(config: ByokConfig): Promise<readonly string[]>;

  /** Re-runs the host's own agent detection (e.g. after the operator installs
   *  a CLI). Optional; without it the rescan button is not rendered. Same
   *  reject-on-failure contract as `detectLocalAgents`. */
  rescanLocalAgents?(): Promise<readonly DetectedAgent[]>;
}

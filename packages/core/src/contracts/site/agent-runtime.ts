/**
 * @file The registry-facing view of a probed coding-agent CLI.
 *
 * Additive verbatim copy of `DetectedAgent` from `@jini-ai/agent-runtime` (`types.ts`) and of its
 * structural closure from `@jini-ai/protocol` (`agent-catalog.ts`: `AgentDiagnostic` and the
 * vocabulary it names); both owning packages keep their identical declarations and exports until
 * the paired cutover. The runtime functions that produce these values (`detectAgents`,
 * `listProviderModels`, `testProviderConnection`) stay in `@jini-ai/agent-runtime`: a contract
 * carries no runtime values.
 */
import type { DefaultModelResolution, ModelCatalogSnapshot, RuntimeAgentDef, RuntimeModelOption, RuntimeModelSource } from "../agents/index.js";

/**
 * A typed "what should the UI do to fix this" intent attached to an
 * {@link AgentDiagnostic}. The UI renders a button per intent and owns the
 * concrete handler (open a URL, re-run detection, write an env override,
 * launch an OAuth terminal flow). Keeping the intent typed — rather than a
 * pre-baked button label + URL — lets multiple surfaces (a settings card,
 * an unavailable-agents grid, a CLI healthcheck) render the same fix
 * affordances from one source of truth instead of each re-deriving copy
 * and wiring.
 *
 * Vendored (minimal, unmodified shape) from OD's
 * `packages/contracts/src/api/registry.ts#AgentFixIntent` — see
 * `archived provenance ledger`. `@jini-ai/agent-runtime` does not depend on OD's
 * contracts workspace package.
 */
export type AgentFixIntent =
  /** Open the agent's configuration / auth docs (`AgentInfo.docsUrl`). */
  | { kind: 'openDocs' }
  /** Open the agent's install / download page (`AgentInfo.installUrl`). */
  | { kind: 'openInstall' }
  /** Re-run agent detection (a Settings "Rescan" affordance). */
  | { kind: 'rescan' }
  /**
   * Prompt the user to point the host application at an explicit binary by
   * writing `envKey` (e.g. `CURSOR_AGENT_BIN`) into a configured-env store.
   * Used when the CLI is installed somewhere PATH detection can't reach.
   */
  | { kind: 'setEnv'; envKey: string }
  /** Clear a previously-set binary override so detection falls back to PATH. */
  | { kind: 'clearEnv'; envKey: string }
  /**
   * Launch the agent's interactive sign-in in a system terminal (used by
   * adapters whose OAuth flow cannot complete in a headless/print mode).
   */
  | { kind: 'launchOAuth'; agentId: string };

export type AgentDiagnosticReason =
  /** The binary (and any fallback names) was not found on PATH. */
  | 'not-on-path'
  /** A file matched but is not executable (missing +x / wrong PATHEXT). */
  | 'not-executable'
  /** A wrapper/shim was found but its target is gone (exit 126/127). */
  | 'shim-broken'
  /** A user-set `*_BIN` override points at a missing/invalid file. */
  | 'configured-bin-invalid'
  /** Installed and invocable, but the CLI is not authenticated. */
  | 'auth-missing'
  /** Installed, but auth status could not be verified. */
  | 'auth-unknown';

export type AgentDiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Why a CLI agent is unavailable or only partially usable, in a shape a UI
 * can render as "one-line reason + fix button(s)" instead of a silent grey
 * card. Vendored from OD's contracts workspace package — see
 * `AgentFixIntent`'s doc comment.
 */
export interface AgentDiagnostic {
  reason: AgentDiagnosticReason;
  severity: AgentDiagnosticSeverity;
  /** Short, human-readable, single-sentence explanation. */
  message: string;
  /** Optional longer context (e.g. the probe's stderr tail). */
  detail?: string;
  /**
   * Directories PATH detection searched, surfaced verbatim for the
   * `not-on-path` case so the user can see where detection looked before
   * being asked to set an explicit binary path.
   */
  searchedDirs?: string[];
  /** Ordered fix affordances the UI should offer for this diagnostic. */
  fixActions?: AgentFixIntent[];
}

export type DetectedAgent = Omit<
  RuntimeAgentDef,
  | 'discoverModels'
  | 'resolveDefaultModel'
  | 'buildArgs'
  | 'listModels'
  | 'fetchModels'
  // A closure like `buildArgs`: `JSON.stringify` would drop the function and leave nothing behind,
  // and a registry consumer has no models list of its own to feed it. Its RESULT is what ships, in
  // the `reasoningOptions` field this same type already carries.
  | 'deriveReasoningOptions'
  | 'fallbackModels'
  // Build-time provenance about the fallback list, for the freshness guard. The fallback list
  // itself is stripped one line above, so a registry consumer has nothing to interpret it
  // against.
  | 'fallbackModelsAssertedAt'
  | 'helpArgs'
  | 'capabilityFlags'
  | 'fallbackBins'
  | 'versionProbeTimeoutMs'
  | 'maxPromptArgBytes'
  | 'env'
  // `inactivityTimeoutMs` is a spawn-time-only hint consumed by a chat-run
  // watchdog. It is not part of a public agent-registry API contract, so
  // omitting it here keeps that response aligned with such a shared
  // web/CLI shape — agents pick it up by reading the runtime def directly,
  // the registry payload stays unchanged.
  | 'inactivityTimeoutMs'
  | 'authProbe'
  // All three of the spawn-orchestration fields are stripped for the same
  // reason `inactivityTimeoutMs` is: they instruct whoever *spawns* the CLI
  // and mean nothing to a registry consumer picking an agent from a list.
  // `stdoutPolicy` and `runtimeLock` additionally carry closures, which a
  // JSON response would silently flatten into a misleading half-object
  // (`{"buffering":"until-close"}` with the sanitizer gone, `{}` for the
  // lock) rather than omit — see `detection.ts#stripFns`.
  | 'needsAgentLogFile'
  | 'stdoutPolicy'
  | 'runtimeLock'
> & {
  models: RuntimeModelOption[];
  modelsSource: RuntimeModelSource;
  modelCatalog?: ModelCatalogSnapshot;
  defaultModelResolution?: DefaultModelResolution;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  diagnostics?: AgentDiagnostic[];
};

/**
 * Agent-catalog vocabulary — what a coding-agent, its model catalogue, its provider, and its
 * unavailability diagnostics *are*, as pure data shapes.
 *
 * These types live in the dependency-free contract package rather than beside the runtime that
 * produces them (`@jini-ai/agent-runtime`) because they cross the wire: `@jini-ai/http-kit`'s
 * agent routes serialize them, and a browser model-picker UI consumes them. Before this split
 * (2026-07-29), `@jini-ai/chat-react` — a `runtime: browser` package — declared a dependency on
 * the Node-only `@jini-ai/agent-runtime` solely to reach five `import type` names, which dragged
 * `@jini-ai/platform` and `undici` into every browser install.
 *
 * `@jini-ai/agent-runtime` re-exports every name below from its own barrel, so nothing that
 * already imported them from there needs to change.
 */

/**
 * Where a provider stands relative to a consumer's stored credentials.
 * `available` covers providers that don't need a credential at all (a local
 * or already-authenticated integration); `configured` and `unconfigured`
 * both require one, differing only in whether it's present.
 */
export type CredentialStatus = 'configured' | 'available' | 'unconfigured';

export interface ModelProvider {
  id: string;
  label: string;
  hint?: string;
  /** False for providers that need no user-supplied credential (e.g. a local integration). */
  credentialsRequired?: boolean;
  docsUrl?: string;
}

/**
 * A single selectable model/reasoning-mode entry in a provider's catalogue.
 * Named `ModelCatalogOption`, not `ModelOption` — this package's
 * `agent-protocol/acp/models.ts` already owns the plain `ModelOption` name
 * for its narrower `{ id, label }` ACP model-probe shape; see this file's
 * module doc comment.
 */
export interface ModelCatalogOption {
  id: string;
  label: string;
  hint?: string;
  providerId: string;
  /** Marks the recommended/default-checked option within its provider group. */
  default?: boolean;
  caps?: string[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  available: boolean;
  version?: string | null;
  models?: ModelCatalogOption[];
  reasoningOptions?: ModelCatalogOption[];
  diagnostics?: AgentDiagnostic[];
  installUrl?: string;
  docsUrl?: string;
  /** False hides free-text/custom model entry for agents whose CLI can't accept one. */
  supportsCustomModel?: boolean;
}

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
 * `source-map.md`. `@jini-ai/agent-runtime` does not depend on OD's
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

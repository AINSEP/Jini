/**
 * @file Wire projections shared by the `agent-plugins` admin routes (list, set-enabled) and the
 * host's install/update route: the lifecycle fields every Agent Plugin row carries.
 *
 * The candidate types are structural: the read model (`AgentPluginSearchCandidate`) lives in the
 * agent-plugins package, which depends on this one, so this file names only the fields it reads.
 */

/** The lifecycle fields of one installed Agent Plugin, as the host's read model reports them. */
export interface AgentPluginLifecycleCandidate {
  readonly maturity?: string | undefined;
  readonly providerPlugin?: string | undefined;
  readonly origin?: string | undefined;
  readonly hostOk?: boolean | undefined;
  readonly missingRequires?: readonly string[] | undefined;
  readonly requiredBy?: readonly string[] | undefined;
  readonly archiveDigest?: string | undefined;
}

/** One installed Agent Plugin as the admin rows read it: identity, display metadata, switch state. */
export interface AgentPluginRowCandidate extends AgentPluginLifecycleCandidate {
  readonly pluginId: string;
  readonly id?: string | undefined;
  readonly provides?: readonly string[] | undefined;
  readonly displayName?: string | undefined;
  readonly summary?: string | undefined;
  readonly version?: string | undefined;
  readonly description?: string | undefined;
  readonly keywords: readonly string[];
  readonly enabled: boolean;
  readonly skills: readonly unknown[];
  readonly mcpServerIds: readonly string[];
}

/** `C[K]` when the candidate type declares `K`, else `undefined` (so a narrower host type keeps its own field types). */
type CandidateField<C, K extends string> = K extends keyof C ? C[K] : undefined;

/** The projected lifecycle fields, typed from the caller's own candidate type. */
export interface AgentPluginLifecycleFields<C extends AgentPluginLifecycleCandidate> {
  maturity?: NonNullable<CandidateField<C, "maturity">>;
  providerPlugin?: string;
  origin: CandidateField<C, "origin">;
  hostOk: boolean | undefined;
  missingRequires: readonly string[];
  requiredBy: readonly string[];
  archiveDigest: string | undefined;
}

/**
 * The lifecycle fields every Agent Plugin row carries (`list.ts`, install/update, `set-enabled.ts`):
 * `origin` (bundled rows are managed by the host: no Update, no Uninstall), `hostOk` (false: this host
 * refuses to enable it), `missingRequires` (advisory capabilities no other enabled plugin provides),
 * `requiredBy` (enabled plugins that would lose a capability if this one were switched off) and
 * `archiveDigest` (the installed revision an update must name). One projection, so the three
 * responses cannot drift.
 * @complexity O(1).
 */
export function agentPluginLifecycleFields<C extends AgentPluginLifecycleCandidate>({ candidate }: { candidate: C }, _optional: Record<string, never> = {}): AgentPluginLifecycleFields<C> {
  return {
    ...(candidate.maturity ? { maturity: candidate.maturity as NonNullable<CandidateField<C, "maturity">> } : {}),
    // The provider plugin whose switch this plugin follows (`provider-plugin-link.ts`); the row shows no switch of its own.
    ...(candidate.providerPlugin ? { providerPlugin: candidate.providerPlugin } : {}),
    origin: candidate.origin as CandidateField<C, "origin">,
    hostOk: candidate.hostOk,
    missingRequires: candidate.missingRequires ?? [],
    requiredBy: candidate.requiredBy ?? [],
    archiveDigest: candidate.archiveDigest,
  };
}

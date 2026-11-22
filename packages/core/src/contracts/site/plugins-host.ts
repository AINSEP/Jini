import type { UUID } from "../../primitives/ids.js";
import type {
  PluginProviderContribution,
  PluginRouteContribution,
  PluginSdk,
  PluginToolContribution,
  PluginWidgetContribution,
} from "../plugin-sdk.js";

/** `plugin_activations` row (durable, behind the gateway) — state.spec.md §2. */
export interface PluginActivationRecord {
  readonly pluginId: string;
  readonly workspaceId: UUID;
  /** The active (enabled) installed version — the "active pointer". */
  readonly version: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
  /** Present only while automatic quarantine is active. A normal enable/disable save omits these
   * fields, which clears the durable marker and makes re-enable the operator recovery action. */
  readonly quarantinedAt?: string;
  readonly quarantineReason?: string;
  readonly quarantineFailureCount?: number;
}

/** Persistence contract — shaped identically to `PresentationSettingsRepoPort` (rule-of-two, two
 * adapters from day one: `repo.memory.ts` / `repo.sqlite.ts`). */
export interface PluginActivationRepoPort {
  getActivation(required: { workspaceId: UUID; pluginId: string }, optional?: Record<string, never>): Promise<PluginActivationRecord | null>;
  save(record: PluginActivationRecord, optional?: Record<string, never>): Promise<void>;
  deleteActivation(required: { workspaceId: UUID; pluginId: string }, optional?: Record<string, never>): Promise<void>;
  /** Every row across every workspace — used by discovery's `enabled` projection and by any
   * future migration, mirrors `PresentationSettingsRepoPort.listAll`. */
  listAll(required?: Record<string, never>, optional?: Record<string, never>): Promise<PluginActivationRecord[]>;
}

/** Storage-neutral contracts for a provider plugin's saved configuration. */
export interface ProviderKeyUsage {
  readonly keyId?: string;
  readonly store: "project" | "site";
  readonly usedByThisSite: boolean;
  readonly usedBy: readonly string[];
}

export interface ProviderWriteResult extends ProviderKeyUsage { readonly keyId: string }

/** One conflict, as the admin screen and the agent see it — the detector's conflict plus the
 *  holder's display name. */
export interface PluginConflict {
  readonly kind: string;
  readonly key: string;
  readonly heldBy: string;
  readonly heldByName: string;
  readonly heldKey: string;
}

/** Structural host removal port, matching the host's trash port without a CMS dependency edge. */
export type RemoveEntity = (required: {
  workspaceId: string; id: string; display: { title: string; subtitle?: string | null }; at: string;
  expectedVersion: number | null; actor: { principalId: string; pluginId?: string | null }; priorMarker?: string | null;
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: 'not-found' | 'version-changed' } | { ok: false; reason: 'blocked'; code: string; count: number }>;

export type RemovePluginFn = RemoveEntity;

export interface PluginContributionsSnapshot {
  readonly pluginId: string; readonly sdk: PluginSdk;
  readonly providers?: readonly PluginProviderContribution[];
  readonly routes: readonly PluginRouteContribution[];
  readonly tools: readonly PluginToolContribution[];
  readonly widgets: readonly PluginWidgetContribution[];
}

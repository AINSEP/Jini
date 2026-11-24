/**
 * @file The admin `agent-plugins` wire DTOs (ADR-029): the JSON bodies the Agent Plugins admin
 * routes (list, files, set-enabled) answer with and an admin client reads. Declared here, once, so
 * the server serializers (`@jini-ai/cms/admin-http/http/agent-plugins` and the route specs under
 * `@jini-ai/cms/admin-http/routes/agent-plugins/*`) and any client mirror read the same shapes
 * without the client depending on CMS. Serialization stays in CMS; only the declarations sit in Core.
 *
 * Core cannot import CMS, so the lifecycle projection is restated structurally here. CMS's
 * `admin-http/http/__tests__/agent-plugins.test.ts` pins it against `agentPluginLifecycleFields`'s
 * return type in both directions; keep the two sides identical.
 *
 * Host-owned value sets (a maturity, an origin, a connection status, a skill summary, a package
 * file entry, the reader's caps) are opaque here: the host's read model decides them, and the
 * route only re-shapes what that read model returned.
 */

/** The lifecycle fields every Agent Plugin row carries (list, set-enabled, the host's install/update). */
export interface AdminAgentPluginLifecycleDto {
  /** Host maturity; the key is absent for a plugin with none. */
  readonly maturity?: string;
  /** The provider plugin whose switch this plugin follows; the key is absent for an unlinked plugin. */
  readonly providerPlugin?: string;
  readonly origin: string | undefined;
  readonly hostOk: boolean | undefined;
  readonly missingRequires: readonly string[];
  readonly requiredBy: readonly string[];
  readonly archiveDigest: string | undefined;
}

/**
 * One installed Agent Plugin row. `displayName`/`summary`/`version`/`description` are nullable,
 * not optional: the wire always sends the key, `null` when the package's own manifest has none.
 */
export interface AdminAgentPluginDto extends AdminAgentPluginLifecycleDto {
  readonly pluginId: string;
  readonly id: string | undefined;
  readonly provides: readonly string[] | undefined;
  readonly displayName: string | null;
  readonly summary: string | null;
  readonly version: string | null;
  readonly description: string | null;
  readonly keywords: readonly string[];
  readonly enabled: boolean;
  /** The host's account state for this plugin; present only on list rows the host reported. */
  readonly connectionStatus?: unknown;
  readonly skills: readonly unknown[];
  readonly mcpServerIds: readonly string[];
}

/**
 * The row as an admin CLIENT reads it after `JSON.parse`: {@link AdminAgentPluginDto} with every
 * key the server may leave out made optional and the host-owned value sets narrowable. The wire
 * drops `undefined` keys, so `maturity`/`origin`/`provides`/... are absent rather than `undefined`
 * on this side, and a client's arrays are plain (mutable) once parsed.
 *
 * Type-only and copy-free: the host's own maturity and connection-status vocabularies (and any
 * wording that goes with them) are NOT named here. A host that wants its closed unions passes them
 * as `Maturity` / `ConnectionStatus` / `Origin` (a binding alias in the host), otherwise they stay
 * plain `string`. `AdminAgentPluginRowKeysFitDto` in `__tests__` fails to compile if a key here
 * stops existing on the DTO, so the two cannot drift apart silently.
 */
export interface AdminAgentPluginRow<
  Maturity extends string = string,
  ConnectionStatus extends string = string,
  Origin extends string = string,
> {
  /** Account state is independent of activation; absent for plugins with no sign-in. */
  connectionStatus?: ConnectionStatus;
  /** Host maturity; absent means normal. */
  maturity?: Maturity;
  /** The provider plugin whose switch this plugin follows; it has no switch of its own. */
  providerPlugin?: string;
  provides?: string[];
  origin?: Origin;
  hostOk?: boolean;
  missingRequires?: string[];
  requiredBy?: string[];
  archiveDigest?: string;
  pluginId: string;
  /** `null` (or absent, from a server predating the field) means title-case `pluginId` instead. */
  displayName?: string | null;
  /** The plain-language explainer a row shows in place of `description` (which is written for the
   *  assistant); `null`/absent means show `description`. */
  summary?: string | null;
  version: string | null;
  description: string | null;
  keywords: string[];
  enabled: boolean;
  skills: Array<{ name: string; summary: string }>;
  mcpServerIds: string[];
}

/** `GET …/agent-plugins`: one row per installed Agent Plugin. */
export interface AdminAgentPluginsListEnvelope {
  readonly agentPlugins: readonly AdminAgentPluginDto[];
}

/** `PATCH …/agent-plugins/:pluginId`: the updated row plus the lifecycle owner's warnings. */
export interface AdminAgentPluginSetEnabledEnvelope {
  readonly warnings: readonly string[];
  readonly agentPlugin: AdminAgentPluginDto;
}

/** `GET …/agent-plugins/:pluginId/files`: one plugin's package files, as the host's reader listed them. */
export interface AdminAgentPluginFilesEnvelope {
  readonly pluginId: string;
  readonly files: readonly unknown[];
  readonly truncated: boolean;
  /** The reader's caps, echoed to the viewer. */
  readonly limits: unknown;
}

/** `GET`/`PUT …/agent-plugins/:pluginId/memory`: the plugin's learned entries and user notes, as the host's store listed them. */
export interface AdminAgentPluginMemoryEnvelope {
  readonly pluginId: string;
  readonly learned: readonly unknown[];
  readonly notes: readonly unknown[];
  /** The store's caps, echoed to the notes editor. */
  readonly limits: unknown;
}

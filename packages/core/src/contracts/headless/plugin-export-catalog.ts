/** Workspace-scoped, model-safe catalog shared by the two plugin families through the host. */
import type { AgentPluginExport } from '../site/agent-plugins-manifest.js';

/** Public component metadata only; never includes package paths, credentials or render handles. */
export interface PluginExportCatalogRow {
  readonly plugin: string;
  readonly displayName?: string;
  readonly component: string;
  readonly version: number;
  readonly minVersion: number;
  readonly props: AgentPluginExport['props'];
  readonly consent: AgentPluginExport['consent'];
  readonly availability: string;
  readonly snippet: string | null;
}

/** Host binding to the Agent Plugin catalog owner. Read failures reject; callers own degradation. */
export interface PluginExportCatalogPort {
  catalog(required: { workspaceId: string }, options?: Record<string, never>): Promise<ReadonlyMap<string, readonly PluginExportCatalogRow[]>>;
}

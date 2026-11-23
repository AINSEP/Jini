/**
 * @file The agent-picker inventory DTO: one row per agent runtime a host offers in a model/agent picker.
 * Browser-safe and types only. Keep it deliberately small: it is a picker DTO, not a way to expose host
 * capabilities to web content. The lister that fills it lives in `@jini-ai/agent-runtime/inventory`;
 * the transport (IPC channel names, HTTP routes) belongs to the host.
 */

/** A model or reasoning-level choice in the picker. */
export type AgentInventoryOption = {
  id: string;
  label: string;
  /** Optional model-specific levels; an empty list suppresses inherited levels. */
  reasoning?: readonly AgentInventoryOption[];
};

/** One agent runtime as the picker shows it; `diagnostic` says why an unavailable one cannot be used. */
export interface AgentInventorySummary {
  id: string;
  name: string;
  available: boolean;
  version: string | null;
  authStatus?: 'ok' | 'missing' | 'unknown';
  models: readonly AgentInventoryOption[];
  reasoningOptions: readonly AgentInventoryOption[];
  reasoningInModelId?: { readonly levels: readonly AgentInventoryOption[] };
  supportsCustomModel?: boolean;
  diagnostic?: string;
}

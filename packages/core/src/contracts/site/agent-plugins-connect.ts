/**
 * @file Credential-save routing ports and the plugin credential-card loader, as types only.
 *
 * An additive copy of the declarations in `@jini-ai/agent-plugins/connect`; that package keeps its
 * identical declarations and exports until the paired cutover.
 */
import type { PluginCredentialCard } from '../credentials.js';
import type { ToolHandler } from '../../tool-registry.js';

/** Host credential kinds delegate to the existing domain authorization and sealed-store owners.
 * Jini owns the secret-card lifecycle; this module only routes non-secret model metadata.
 */
export interface CredentialSaveAdapters {
  readonly apiCreate: ToolHandler;
  readonly apiRotate: ToolHandler;
  readonly mediaProvider: ToolHandler;
  readonly sourceControl: ToolHandler;
  readonly publishHost: ToolHandler;
  readonly agentPluginToken: ToolHandler;
  readonly pluginProvider: ToolHandler;
  /** A provider plugin's settings card (`saveKind: "provider-settings"`); absent where no settings store is wired. */
  readonly providerSettings?: ToolHandler;
}

/** Composition-supplied loader; absent when no plugin catalog can declare cards here. */
export type LoadPluginCredentialCards = (workspaceId: string) => Promise<readonly PluginCredentialCard[]>;

/**
 * @file Type-only copy of the plugin lookup vocabulary declared in `@jini-ai/core/plugin-directory`
 * (`plugin-directory.d.ts` at the package root, outside `src/`), so contracts under `src/contracts/**`
 * can name it through a relative core import. The root declaration and its runtime helpers stay
 * unchanged; the two copies are structurally identical.
 */
export interface PluginProvider {
  readonly id: string;
  readonly version: string | null;
  readonly enabled: boolean;
  readonly family: string;
  /** Stable storage/activation key; publisher identity never becomes a filesystem path. */
  readonly localId: string;
  readonly keywords: readonly string[];
  readonly provides: readonly string[];
}
export interface PluginLookupPort {
  getPlugin(required: { readonly id: string; readonly family?: string }, optional?: Record<string, never>): Promise<PluginProvider | null>;
  findProviders(required: { readonly capability: string }, optional?: { readonly enabledOnly?: boolean }): Promise<readonly PluginProvider[]>;
}
export type PluginIdentityCandidate = Pick<PluginProvider, 'id' | 'family' | 'localId'>;

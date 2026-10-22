/** Identical identity metadata for portable agent packages and host site plugins. */
export interface PluginIdentityExtension {
  readonly id?: string;
  readonly provides?: readonly string[];
  readonly [key: string]: unknown;
}
export interface PluginIdentity {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly provides: readonly string[];
  readonly warnings: readonly string[];
}
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
export function assertPluginIdentityAvailable(required: { readonly candidate: PluginIdentityCandidate; readonly installed: readonly PluginProvider[] }, optional?: Record<string, never>): void;
export function createPluginLookupFacade(required: { readonly lookup: PluginLookupPort }, optional?: Record<string, never>): PluginLookupPort;
export function validatePluginIdentity(required: { readonly manifest: unknown; readonly namespace: string }, optional?: Record<string, never>): { readonly errors: readonly string[] };
export function readPluginIdentity(required: { readonly manifest: Readonly<Record<string, unknown>>; readonly namespace: string; readonly name?: string }, optional?: Record<string, never>): PluginIdentity;
export function createPluginLookup(required: { readonly listPlugins: (required: Record<string, never>, optional?: Record<string, never>) => Promise<readonly PluginProvider[]> }, optional?: { readonly warn?: (message: string) => void }): PluginLookupPort;

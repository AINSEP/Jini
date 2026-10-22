/** Bundled chart declarations only. ADR-025 trust comes from composition, never the manifest. */
import type { BrowserProviderDeclaration, PluginValidationError } from './manifest-types.js';
export type { BrowserProviderDeclaration } from './manifest-types.js';
import { isNonArrayRecord } from '@jini-ai/core/records';
export interface BrowserProviderAsset {
  readonly path: string;
  readonly digest: string;
  readonly contentType: 'text/javascript' | 'text/css';
  /** A fresh copy of retained verified bytes, never a filesystem read. */
  readBytes(input: Record<string, never>, options?: Record<string, never>): Uint8Array;
}
export interface AdmittedBrowserProvider {
  readonly pluginId: string;
  readonly version: string;
  readonly declaration: BrowserProviderDeclaration;
  readonly assets: readonly BrowserProviderAsset[];
}

/** Portable package-relative paths. Refuse dot segments, URL syntax and alternate separators. */
export function isPluginRelativePath({ path }: { path: string }, _options: Record<string, never> = {}): boolean {
  return path.length > 0 && !/[\\:\u0000-\u001f]/.test(path) && path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function validChartKinds({ kinds }: { kinds: unknown }, _options: Record<string, never> = {}): boolean {
  return Array.isArray(kinds) && kinds.length > 0
    && !kinds.some((kind) => typeof kind !== 'string' || kind.trim() === '')
    && new Set(kinds).size === kinds.length;
}

function validateBrowserProviderDeclaration(
  { provider, ids }: { provider: Record<string, unknown>; ids: Set<string> },
  _options: Record<string, never> = {},
): string[] {
  const errors: string[] = [];
  if (Object.keys(provider).some((key) => !['id', 'kind', 'contractVersion', 'kinds', 'javascript', 'stylesheet'].includes(key))) errors.push('Unknown browser provider field.');
  if (typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(provider.id) || ids.has(provider.id)) errors.push('Browser provider id must be unique and non-empty.');
  if (typeof provider.id === 'string') ids.add(provider.id);
  if (provider.kind !== 'chart' || provider.contractVersion !== 1) errors.push('Only chart contractVersion 1 is supported.');
  if (!validChartKinds({ kinds: provider.kinds })) errors.push('Chart kinds must be unique non-empty strings.');
  return errors;
}

function validateBrowserProviderAssets(
  { provider, integrity }: { provider: Record<string, unknown>; integrity: Readonly<Record<string, unknown>> },
  _options: Record<string, never> = {},
): string[] {
  const errors: string[] = [];
  for (const [key, suffix] of [['javascript', /\.(?:m?js)$/], ['stylesheet', /\.css$/]] as const) {
    const file = provider[key];
    if (key === 'stylesheet' && file === undefined) continue;
    if (typeof file !== 'string' || !isPluginRelativePath({ path: file }) || !file.startsWith('client/') || !suffix.test(file) || !/^sha256-[0-9a-f]{64}$/.test(String(integrity[file]))) errors.push(`Browser provider ${key} must name a digest-covered client asset.`);
  }
  return errors;
}

/** Collect static declaration errors; admission additionally requires compiled-in host pins.
 * @example validateBrowserProviders({ browserProviders, integrity })
 */
export function validateBrowserProviders(
  { browserProviders, integrity }: { browserProviders: unknown; integrity: Readonly<Record<string, unknown>> },
  _options: Record<string, never> = {},
): readonly PluginValidationError[] {
  if (browserProviders === undefined) return [];
  const errors: PluginValidationError[] = [];
  const invalid = (message: string): void => { errors.push({ code: 'BROWSER_PROVIDER_INVALID', file: null, message }); };
  if (!Array.isArray(browserProviders)) { invalid('browserProviders must be a list.'); return errors; }
  const ids = new Set<string>();
  for (const value of browserProviders) {
    if (!isNonArrayRecord({ value })) { invalid('Browser provider must be an object.'); continue; }
    const provider = value as Record<string, unknown>;
    validateBrowserProviderDeclaration({ provider, ids }).forEach(invalid);
    validateBrowserProviderAssets({ provider, integrity }).forEach(invalid);
  }
  return errors;
}

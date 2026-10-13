/** Bundled chart declarations only. ADR-025 trust comes from composition, never the manifest. */
import type { PluginValidationError } from './manifest.js';

export interface BrowserProviderDeclaration {
  readonly id: string;
  readonly kind: 'chart';
  readonly contractVersion: 1;
  readonly kinds: readonly string[];
  readonly javascript: string;
  readonly stylesheet?: string;
}
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
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { invalid('Browser provider must be an object.'); continue; }
    const provider = value as Record<string, unknown>;
    if (Object.keys(provider).some((key) => !['id', 'kind', 'contractVersion', 'kinds', 'javascript', 'stylesheet'].includes(key))) invalid('Unknown browser provider field.');
    if (typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(provider.id) || ids.has(provider.id)) invalid('Browser provider id must be unique and non-empty.');
    if (typeof provider.id === 'string') ids.add(provider.id);
    if (provider.kind !== 'chart' || provider.contractVersion !== 1) invalid('Only chart contractVersion 1 is supported.');
    if (!Array.isArray(provider.kinds) || provider.kinds.length === 0 || provider.kinds.some((kind) => typeof kind !== 'string' || kind.trim() === '') || new Set(provider.kinds).size !== provider.kinds.length) invalid('Chart kinds must be unique non-empty strings.');
    for (const [key, suffix] of [['javascript', /\.(?:m?js)$/], ['stylesheet', /\.css$/]] as const) {
      const file = provider[key];
      if (key === 'stylesheet' && file === undefined) continue;
      if (typeof file !== 'string' || !isPluginRelativePath({ path: file }) || !file.startsWith('client/') || !suffix.test(file) || !/^sha256-[0-9a-f]{64}$/.test(String(integrity[file]))) invalid(`Browser provider ${key} must name a digest-covered client asset.`);
    }
  }
  return errors;
}

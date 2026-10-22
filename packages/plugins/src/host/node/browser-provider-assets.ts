/** Retained byte admission extends the ordered loader; no second activation or trust store. */
import { snapshotSitePluginPackage } from './install.js';
import { verifyPluginSnapshotIntegrity } from './module-snapshot.js';
import { validateBrowserProviders, type AdmittedBrowserProvider, type BrowserProviderAsset } from '../browser-providers.js';
import type { PluginManifest } from '../manifest.js';
import type { PluginDiscoveryRecord } from '../discovery-types.js';
import type { BundledBrowserProviderApproval } from '../ports.js';

export type BrowserProviderAdmissionResult =
  | { readonly admitted: true; readonly providers: readonly AdmittedBrowserProvider[] }
  | { readonly admitted: false; readonly reason: 'BROWSER_PROVIDER_FORBIDDEN' | 'BROWSER_PROVIDER_INVALID' | 'INTEGRITY_FAILED' };

/** Compare review-owned declarations with what the discovered manifest requests. Array order is
 * significant (capability preference); object key order is not. No self-declared trust field exists.
 */
function matchesDeclaration(manifest: PluginManifest, approval: BundledBrowserProviderApproval): boolean {
  const requested = manifest.browserProviders ?? [];
  return requested.length === approval.browserProviders.length && requested.every((provider, index) => {
    const pinned = approval.browserProviders[index]!;
    return provider.id === pinned.id && provider.kind === pinned.kind && provider.contractVersion === pinned.contractVersion
      && provider.javascript === pinned.javascript && provider.stylesheet === pinned.stylesheet
      && JSON.stringify(provider.kinds) === JSON.stringify(pinned.kinds);
  });
}

/** A closure retains its own copy; neither the returned metadata nor a caller's bytes can mutate it. */
function retainedAsset(path: string, bytes: Uint8Array, digest: string, contentType: BrowserProviderAsset['contentType']): BrowserProviderAsset {
  const retained = Uint8Array.from(bytes);
  return Object.freeze({ path, digest, contentType, readBytes: (_input: Record<string, never>, _options: Record<string, never> = {}) => retained.slice() });
}

/** After SDK/integrity checks, admit ONLY reviewed compiled-in chart providers. Use the existing
 * bounded snapshot and integrity owner on retained bytes, then serve those bytes rather than paths.
 * @example admitBrowserProviderAssets({ record, manifest, pluginRoot, approvals: compiledInPins })
 */
export async function admitBrowserProviderAssets(
  { record, manifest, pluginRoot, approvals }: { record: PluginDiscoveryRecord; manifest: PluginManifest; pluginRoot: string; approvals: readonly BundledBrowserProviderApproval[] },
  _options: Record<string, never> = {},
): Promise<BrowserProviderAdmissionResult> {
  if (validateBrowserProviders({ browserProviders: manifest.browserProviders, integrity: manifest.integrity }).length) return { admitted: false, reason: 'BROWSER_PROVIDER_INVALID' };
  const approval = approvals.find((approval) => approval.pluginId === record.id && approval.version === manifest.version);
  if (record.source !== 'built-in' || !approval || !matchesDeclaration(manifest, approval)) return { admitted: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' };
  // The manifest may not replace the reviewed digests, even with a self-consistent tampered map.
  if (Object.keys(manifest.integrity).length !== Object.keys(approval.integrity).length || Object.entries(approval.integrity).some(([file, digest]) => manifest.integrity[file] !== digest)) return { admitted: false, reason: 'INTEGRITY_FAILED' };
  try {
    const files = await snapshotSitePluginPackage({ sourceDir: pluginRoot });
    verifyPluginSnapshotIntegrity({ files, integrity: approval.integrity });
    const providers = (manifest.browserProviders ?? []).map((declaration): AdmittedBrowserProvider => {
      const paths = [declaration.javascript, ...(declaration.stylesheet ? [declaration.stylesheet] : [])];
      const assets = paths.map((file) => retainedAsset(file, files.get(file)!, approval.integrity[file]!, file.endsWith('.css') ? 'text/css' : 'text/javascript'));
      return Object.freeze({ pluginId: record.id, version: manifest.version,
        declaration: Object.freeze({ ...declaration, kinds: Object.freeze([...declaration.kinds]) }), assets: Object.freeze(assets) });
    });
    return { admitted: true, providers: Object.freeze(providers) };
  } catch {
    return { admitted: false, reason: 'INTEGRITY_FAILED' };
  }
}

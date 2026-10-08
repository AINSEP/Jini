import { discoverPlugins as discover, siteEntryPath as entry, type DiscoverPluginsRequired } from '../../node/discovery.js';
import { manifestHost, tierPolicy } from './fixture-bindings.js';
export * from '../../node/discovery.js';
export function discoverPlugins(required: Omit<DiscoverPluginsRequired, keyof typeof manifestHost | 'tierPolicy'>, optional = {}) {
  return discover({ ...manifestHost, tierPolicy, ...required }, optional);
}
export function siteEntryPath(installDir: string, id: string, version: string) { return entry({ installDir, id, version }); }

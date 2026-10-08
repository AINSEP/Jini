import { pluginClaimsFromManifest as claims, resolvePluginConflicts as resolve, type ResolvePluginConflictsRequired, type ResolvePluginConflictsOptional } from '../../plugin-claims.js';
import type { PluginManifest } from '../../manifest.js';
import { manifestHost } from './fixture-bindings.js';
export * from '../../plugin-claims.js';
export function pluginClaimsFromManifest(required: { manifest: PluginManifest }, optional: Parameters<typeof claims>[1] = {}) { return claims({ ...manifestHost, ...required }, optional); }
export function resolvePluginConflicts(required: Omit<ResolvePluginConflictsRequired, 'pluginSdkBinding' | 'declarativeContentTypes' | 'coreOwnerName'>, optional: ResolvePluginConflictsOptional = {}) { return resolve({ ...manifestHost, ...required }, optional); }

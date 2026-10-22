/** Preserves the legacy test importer seam; real file loading uses the extracted snapshot owner. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadPlugin as load, type LoadPluginRequired } from '../../node/loader.js';
import { snapshotPluginModuleGraph } from '../../node/module-snapshot.js';
import { attachLoadedPlugin as attach, type AttachLoadedPluginRequired } from '../../attach-loaded-plugin.js';
import type { HookRegistry as HostRegistry } from '../../hook-registry.js';
import type { HookRegistry } from './hook-registry.js';
import type { BeforeSaveFilter } from './fixture-sdk.js';
import { pluginSdkBinding, tierPolicy } from './fixture-bindings.js';
export * from '../../node/loader.js';
export function loadPlugin(required: Omit<LoadPluginRequired, 'pluginSdkBinding' | 'importModule' | 'verifyDigest' | 'tierPolicy'>, optional: {
  runtimeSdkVersion?: string; importModule?: (entryPath: string) => Promise<unknown>; computeFileHash?: (absoluteFilePath: string) => Promise<string>;
} = {}) {
  return load({ ...required, tierPolicy, pluginSdkBinding: { ...pluginSdkBinding, runtimeSdkVersion: optional.runtimeSdkVersion ?? pluginSdkBinding.runtimeSdkVersion },
    verifyDigest: ({ absoluteFilePath }) => optional.computeFileHash ? optional.computeFileHash(absoluteFilePath) : readFile(absoluteFilePath).then((bytes) => `sha256-${createHash('sha256').update(bytes).digest('hex')}`),
    importModule: async ({ modulePath, plugin }) => {
      let moduleValue: unknown;
      if (optional.importModule) moduleValue = await optional.importModule(modulePath);
      else {
        const importPath = required.record.source === 'site' ? await snapshotPluginModuleGraph({ pluginRoot: plugin.packageRoot, manifest: required.manifest }) : modulePath;
        moduleValue = await import(pathToFileURL(importPath).href);
      }
      return { exported: (moduleValue as { default?: unknown } | null)?.default };
    },
  });
}
export function attachLoadedPlugin(required: Omit<AttachLoadedPluginRequired, 'hookRegistry' | 'filter'> & { hookRegistry: HookRegistry; filter: BeforeSaveFilter }, optional = {}) {
  const registry = required.hookRegistry;
  const bridge: HostRegistry = {
    attach: ({ pluginId, source, filter, declaredFields }) => registry.attach(pluginId, source, filter as unknown as BeforeSaveFilter, declaredFields),
    detach: ({ pluginId }) => registry.detach(pluginId),
    runBeforeSave: ({ entry }) => registry.runBeforeSave(entry as Parameters<HookRegistry['runBeforeSave']>[0]),
    previewBeforeSave: ({ pluginId, entry }) => registry.previewBeforeSave(pluginId, entry as Parameters<HookRegistry['runBeforeSave']>[0]),
  };
  return attach({ ...required, hookRegistry: bridge, filter: required.filter as unknown as AttachLoadedPluginRequired['filter'] }, optional);
}

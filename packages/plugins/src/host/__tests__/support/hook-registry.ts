import { createHookRegistry as create, type HookRegistry as HostRegistry, type CreateHookRegistryOptions, type HookRegistryFieldDecl, type AttachmentSource } from '../../hook-registry.js';
import type { ContentEntryDraft, BeforeSaveFilter } from './fixture-sdk.js';
import type { BeforeSaveFilter as HostFilter } from '../../ports.js';
import { pluginSdkBinding } from './fixture-bindings.js';
export * from '../../hook-registry.js';
export interface HookRegistry {
  attach(pluginId: string, source: AttachmentSource, filter: BeforeSaveFilter, declaredFields: readonly HookRegistryFieldDecl[]): void;
  detach(pluginId: string): void;
  runBeforeSave(entry: Readonly<ContentEntryDraft>): ReturnType<HostRegistry['runBeforeSave']>;
  previewBeforeSave(pluginId: string, entry: Readonly<ContentEntryDraft>): ReturnType<HostRegistry['previewBeforeSave']>;
}
export function createHookRegistry(options: CreateHookRegistryOptions = {}): HookRegistry {
  const registry = create({ pluginSdkBinding }, options);
  return {
    attach: (pluginId, source, filter, declaredFields) => registry.attach({ pluginId, source, filter: filter as unknown as HostFilter, declaredFields }),
    detach: (pluginId) => registry.detach({ pluginId }),
    runBeforeSave: (entry) => registry.runBeforeSave({ entry }),
    previewBeforeSave: (pluginId, entry) => registry.previewBeforeSave({ pluginId, entry }),
  };
}

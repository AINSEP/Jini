import { createTier2ImportSeam as create, type CreateTier2ImportSeamRequired } from '../../worker/import-seam.js';
import { pluginSdkBinding } from './fixture-bindings.js';
export function createTier2ImportSeam(required: Omit<CreateTier2ImportSeamRequired, 'pluginSdkBinding'>, optional: { resolveWorkerEntry?: (entryPath: string) => Promise<string> } = {}) {
  const seam = create({ ...required, pluginSdkBinding }, optional.resolveWorkerEntry ? { resolveWorkerEntry: ({ entryPath }) => optional.resolveWorkerEntry!(entryPath) } : {});
  return async (entryPath: string) => {
    const result = await seam({ plugin: { pluginId: required.manifest.id, packageRoot: entryPath }, modulePath: entryPath });
    if (typeof result === 'string') throw new Error(result);
    return { default: result.exported };
  };
}

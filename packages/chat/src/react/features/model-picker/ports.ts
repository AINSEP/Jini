import type { FetchProviderModelsInput, FetchProviderModelsResult } from './types.js';

/**
 * The DI seam for anything transport-shaped this feature needs. Optional —
 * a host that only ever supplies a static model list needs no port at all;
 * `fetchProviderModels` exists for hosts that want to warm a live catalogue
 * (mirrors OD's `fetchProviderModels`/`providerModelsCache` pair).
 */
export interface ModelPickerPort {
  fetchProviderModels?(input: FetchProviderModelsInput): Promise<FetchProviderModelsResult>;
}

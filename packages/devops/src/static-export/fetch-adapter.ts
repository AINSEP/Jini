import type { ExportFetchPort } from './contracts.js';

/** Adapt a host-selected native/guarded fetch; no global transport is selected. */
export function createExportFetchAdapter(required: { fetch: typeof fetch }, _optional = {}): ExportFetchPort {
  return ({ url }, optional = {}) => required.fetch(url, optional.init);
}

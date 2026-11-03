/** Wire metadata belongs to the channel adapter, never to rendered HTML or model context. */
export const SURFACE_EXCHANGE_META = 'jini/surface-exchange';
export interface SurfaceRecoveryInfo { readonly exchangeId: string; readonly toolId: string; readonly runId: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read only server-issued exchange identity; original tool arguments never cross this boundary.
 * @complexity O(1). */
export function surfaceRecoveryInfo({ value }: { value: unknown }, _options = {}): SurfaceRecoveryInfo | undefined {
  if (!record(value)) return undefined;
  if (typeof value.exchangeId !== 'string' || typeof value.toolId !== 'string' || typeof value.runId !== 'string') return undefined;
  if (!value.exchangeId || !value.toolId || !value.runId) return undefined;
  return { exchangeId: value.exchangeId, toolId: value.toolId, runId: value.runId };
}

/** Preserve the existing bare-resource renderer contract while attaching recovery identity.
 * @complexity O(1), shallow copies only. Malformed resources remain the renderer's responsibility. */
export function recoverableSurfaceResource({ resource, exchange }: { resource: unknown; exchange: unknown }, _options = {}): unknown {
  const info = surfaceRecoveryInfo({ value: exchange });
  if (!info || !record(resource) || !record(resource.resource)) return resource;
  const meta = record(resource.resource._meta) ? resource.resource._meta : {};
  return { ...resource, resource: { ...resource.resource, _meta: { ...meta, [SURFACE_EXCHANGE_META]: info } } };
}

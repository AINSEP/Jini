import { expect, test } from 'vitest';
import { recoverableSurfaceResource, surfaceRecoveryInfo, SURFACE_EXCHANGE_META } from '../surface-recovery.js';

test('saved cards retain only exchange identity so returning to chat can restore the original request', () => {
  const resource = { type: 'resource', resource: { uri: 'ui://card', text: '<form>', _meta: { existing: true } } };
  const info = { exchangeId: 'card', toolId: 'save', runId: 'run' };
  expect(recoverableSurfaceResource({ resource, exchange: { ...info, input: { secret: 'never-copy-this' } } }))
    .toEqual({ ...resource, resource: { ...resource.resource, _meta: { existing: true, [SURFACE_EXCHANGE_META]: info } } });
  expect(resource.resource._meta).toEqual({ existing: true });
});

test('malformed or absent recovery metadata leaves existing cards unchanged', () => {
  for (const value of [null, [], {}, { exchangeId: '', toolId: 'save', runId: 'run' }, { exchangeId: 'card', toolId: 2, runId: 'run' }]) {
    expect(surfaceRecoveryInfo({ value })).toBeUndefined();
    const resource = { resource: { text: 'card' } };
    expect(recoverableSurfaceResource({ resource, exchange: value })).toBe(resource);
  }
  const exchange = { exchangeId: 'card', toolId: 'save', runId: 'run' };
  for (const resource of [null, {}, { resource: null }]) expect(recoverableSurfaceResource({ resource, exchange })).toBe(resource);
  expect(recoverableSurfaceResource({ resource: { resource: {} }, exchange }))
    .toEqual({ resource: { _meta: { [SURFACE_EXCHANGE_META]: exchange } } });
});

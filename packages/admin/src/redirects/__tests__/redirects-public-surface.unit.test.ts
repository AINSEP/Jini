import { describe, expect, it } from 'vitest';
import * as redirects from '../index.js';

describe('@jini-ai/admin/redirects public surface', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(redirects).sort()).toEqual([
      'KEYS',
      'REDIRECTS_RESOURCE',
      'buildCreateRedirectPayload',
      'createHitCountController',
      'createImportRedirectsController',
      'createRedirectsController',
      'firstWriteError',
      'isAnyWritePending',
      'nextRedirectStatus',
      'parseImportPayload',
      'redirectRowMenuItems',
      'redirectsApiToken',
      'redirectsEventsToken',
      'redirectsMessagesEn',
      'redirectsModule',
      'translateRedirectsEn',
      'visibleRedirectsError',
    ]);
  });
});

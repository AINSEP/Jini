import { describe, expect, it } from 'vitest';
import * as runtime from '../index.js';

describe('@jini-ai/core/admin-runtime public surface', () => {
  it('exports exactly the pure runtime the admin module owners import', () => {
    expect(Object.keys(runtime).sort()).toEqual([
      'AdminApiError',
      'AdminConfigError',
      'createControllerStore',
      'describeApiError',
      'hasPermission',
      'isPanelAccessible',
      'querySuffix',
      'withoutInaccessiblePanels',
    ]);
  });
});

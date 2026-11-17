import { describe, expect, it } from 'vitest';
import * as core from '../index.js';

describe('@jini-ai/admin/core public surface', () => {
  it('T9: exports the panel-access rules beside hasPermission', () => {
    expect(typeof core.hasPermission).toBe('function');
    expect(typeof core.isPanelAccessible).toBe('function');
    expect(typeof core.withoutInaccessiblePanels).toBe('function');
  });
});

import { describe, expect, it } from 'vitest';
import * as AppearanceBarrel from '../index.js';

describe('appearance tab barrel', () => {
  it('exports THEME_OPTIONS and the AppearanceTab component', () => {
    expect(Array.isArray(AppearanceBarrel.THEME_OPTIONS)).toBe(true);
    expect(AppearanceBarrel.THEME_OPTIONS.length).toBeGreaterThan(0);
    expect(typeof AppearanceBarrel.AppearanceTab).toBe('function');
  });
});

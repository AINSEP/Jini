import { describe, expect, it } from 'vitest';
import * as LanguageBarrel from '../index.js';

describe('language tab barrel', () => {
  it('exports the LanguageTab component', () => {
    expect(typeof LanguageBarrel.LanguageTab).toBe('function');
  });
});

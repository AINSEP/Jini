import { describe, expect, it } from 'vitest';
import * as InstructionsBarrel from '../index.js';

describe('instructions tab barrel', () => {
  it('exports the InstructionsTab component', () => {
    expect(typeof InstructionsBarrel.InstructionsTab).toBe('function');
  });
});

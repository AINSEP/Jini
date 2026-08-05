import { describe, expect, it } from 'vitest';
import { defaultModelPickerPort } from '../dependencies.js';

describe('defaultModelPickerPort', () => {
  it('is a no-op port: no live provider-model fetch wired in by default', () => {
    expect(defaultModelPickerPort).toEqual({});
    expect(defaultModelPickerPort.fetchProviderModels).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import * as modelPicker from '../index.js';

describe('features/model-picker barrel', () => {
  it('re-exports the public rules, port default, hook, and components', () => {
    // Runtime exports only — types.js/ports.js/constants.js's re-exported members are
    // type-only or plain data, not observable through a re-export smoke test.
    expect(modelPicker.groupModelsByProvider).toBeTypeOf('function');
    expect(modelPicker.filterModelGroups).toBeTypeOf('function');
    expect(modelPicker.findSelectedModel).toBeTypeOf('function');
    expect(modelPicker.firstAvailableModelId).toBeTypeOf('function');
    expect(modelPicker.isCustomModelId).toBeTypeOf('function');
    expect(modelPicker.matchesModelQuery).toBeTypeOf('function');
    expect(modelPicker.modelSubtitle).toBeTypeOf('function');
    expect(modelPicker.DEFAULT_MIN_SEARCHABLE_OPTIONS).toBeTypeOf('number');
    expect(modelPicker.CREDENTIAL_STATUS_SORT_PRIORITY).toEqual({
      configured: 0,
      available: 1,
      unconfigured: 2,
    });
    expect(modelPicker.defaultModelPickerPort).toEqual({});
    expect(modelPicker.useModelPicker).toBeTypeOf('function');
    expect(modelPicker.ModelPicker).toBeTypeOf('function');
    expect(modelPicker.CredentialStatusBadge).toBeTypeOf('function');
  });
});

import { expect, test } from 'vitest';
import { currentModelFromSessionResult, findModelConfigOption, normalizeModels } from '../models.js';

const defaultModelOption = { id: 'default', label: 'Default' };

test('untyped model options normalize absent values to an empty list and fall back to legacy models', () => {
  const configOptions = [{ id: ' model ', currentValue: '  ', options: null }];
  expect(findModelConfigOption(configOptions)).toEqual({ configId: 'model', currentValue: null, values: [] });
  expect(normalizeModels({ defaultModelOption, models: { currentModelId: 'legacy', availableModels: [null, { modelId: 'legacy', name: 'Legacy' }] } }, { configOptions })).toEqual([
    defaultModelOption, { id: 'legacy', label: 'Legacy (legacy) • current' },
  ]);
  expect(currentModelFromSessionResult({ configOptions, models: { currentModelId: ' legacy ' } })).toBe('legacy');
});

test('a config option with a different category cannot masquerade as model selection through its name', () => {
  const configOptions = [{ id: 'other', category: 'mode', name: 'Model', options: [{ value: 'wrong' }] }];
  expect(findModelConfigOption(configOptions)).toBeNull();
  expect(normalizeModels({ models: {}, defaultModelOption }, { configOptions })).toEqual([defaultModelOption]);
  expect(currentModelFromSessionResult({ configOptions, models: { currentModelId: '   ' } })).toBeNull();
});

import { describe, expect, it } from 'vitest';
import {
  filterModelGroups,
  findSelectedModel,
  firstAvailableModelId,
  groupModelsByProvider,
  isCustomModelId,
  matchesModelQuery,
  modelSubtitle,
} from './rules.js';
import type { ModelOption, ModelPickerGroup, ModelProvider } from './types.js';

const openai: ModelProvider = { id: 'openai', label: 'OpenAI', credentialsRequired: true };
const local: ModelProvider = { id: 'local', label: 'Local', credentialsRequired: false };

const gpt5: ModelOption = { id: 'gpt-5', label: 'GPT-5', hint: 'OpenAI · flagship', providerId: 'openai', default: true };
const gpt5mini: ModelOption = { id: 'gpt-5-mini', label: 'GPT-5 mini', providerId: 'openai' };
const llama: ModelOption = { id: 'llama', label: 'Llama', hint: 'runs offline', providerId: 'local' };

describe('groupModelsByProvider', () => {
  it('groups models by providerId and attaches resolved status', () => {
    const groups = groupModelsByProvider(
      [gpt5, gpt5mini, llama],
      [openai, local],
      { openai: 'configured', local: 'available' },
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ provider: openai, status: 'configured', models: [gpt5, gpt5mini] });
    expect(groups[1]).toEqual({ provider: local, status: 'available', models: [llama] });
  });

  it('sorts configured providers before available, before unconfigured, preserving insertion order within a tier', () => {
    const anthropic: ModelProvider = { id: 'anthropic', label: 'Anthropic' };
    const groups = groupModelsByProvider(
      [
        { id: 'a', label: 'A', providerId: 'anthropic' },
        { id: 'l', label: 'L', providerId: 'local' },
        { id: 'g', label: 'G', providerId: 'openai' },
      ],
      [anthropic, local, openai],
      { anthropic: 'unconfigured', local: 'available', openai: 'configured' },
    );
    expect(groups.map((g) => g.provider.id)).toEqual(['openai', 'local', 'anthropic']);
  });

  it('synthesizes a fallback provider (id as label) for a model whose providerId has no matching provider entry', () => {
    const groups = groupModelsByProvider([{ id: 'x', label: 'X', providerId: 'mystery' }], [], {});
    expect(groups).toEqual([{ provider: { id: 'mystery', label: 'mystery' }, status: 'unconfigured', models: [{ id: 'x', label: 'X', providerId: 'mystery' }] }]);
  });

  it('returns an empty array for an empty model list', () => {
    expect(groupModelsByProvider([], [openai], { openai: 'configured' })).toEqual([]);
  });
});

describe('matchesModelQuery', () => {
  it('matches on model id, label, hint, or provider label against an already-normalized (lowercased) query', () => {
    expect(matchesModelQuery(gpt5, openai, 'gpt-5')).toBe(true);
    expect(matchesModelQuery(gpt5, openai, 'flagship')).toBe(true);
    expect(matchesModelQuery(gpt5, openai, 'openai')).toBe(true);
    expect(matchesModelQuery(gpt5, openai, 'no-match')).toBe(false);
  });

  it('is case-insensitive toward the haystack even though the query is expected pre-normalized', () => {
    const upperLabel: ModelProvider = { id: 'openai', label: 'OPENAI' };
    expect(matchesModelQuery(gpt5, upperLabel, 'openai')).toBe(true);
  });

  it('matches against an empty hint safely', () => {
    expect(matchesModelQuery(gpt5mini, openai, 'gpt-5-mini')).toBe(true);
    expect(matchesModelQuery(gpt5mini, openai, 'nonexistent')).toBe(false);
  });
});

describe('filterModelGroups', () => {
  const groups: ModelPickerGroup[] = [
    { provider: openai, status: 'configured', models: [gpt5, gpt5mini] },
    { provider: local, status: 'available', models: [llama] },
  ];

  it('returns a shallow copy of every group when the query is blank', () => {
    const result = filterModelGroups(groups, '   ');
    expect(result).toEqual(groups);
    expect(result).not.toBe(groups);
    expect(result[0]).not.toBe(groups[0]);
  });

  it('filters models within each group and drops empty groups', () => {
    const result = filterModelGroups(groups, 'offline');
    expect(result).toEqual([{ provider: local, status: 'available', models: [llama] }]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterModelGroups(groups, 'nothing-matches-this')).toEqual([]);
  });
});

describe('findSelectedModel', () => {
  const groups: ModelPickerGroup[] = [{ provider: openai, status: 'configured', models: [gpt5, gpt5mini] }];

  it('finds the group and model for a matching id', () => {
    expect(findSelectedModel(groups, 'gpt-5-mini')).toEqual({ model: gpt5mini, group: groups[0] });
  });

  it('returns null for a null/undefined/empty id', () => {
    expect(findSelectedModel(groups, null)).toBeNull();
    expect(findSelectedModel(groups, undefined)).toBeNull();
    expect(findSelectedModel(groups, '')).toBeNull();
  });

  it('returns null when no group contains the id', () => {
    expect(findSelectedModel(groups, 'unknown-model')).toBeNull();
  });
});

describe('isCustomModelId', () => {
  const groups: ModelPickerGroup[] = [{ provider: openai, status: 'configured', models: [gpt5] }];

  it('is false for a blank id', () => {
    expect(isCustomModelId(null, groups)).toBe(false);
    expect(isCustomModelId('', groups)).toBe(false);
  });

  it('is false for an id present in a group', () => {
    expect(isCustomModelId('gpt-5', groups)).toBe(false);
  });

  it('is true for a set id absent from every group', () => {
    expect(isCustomModelId('some-custom-id', groups)).toBe(true);
  });
});

describe('firstAvailableModelId', () => {
  it('returns the first model of the first group', () => {
    const groups: ModelPickerGroup[] = [{ provider: openai, status: 'configured', models: [gpt5, gpt5mini] }];
    expect(firstAvailableModelId(groups)).toBe('gpt-5');
  });

  it('returns null when there are no groups', () => {
    expect(firstAvailableModelId([])).toBeNull();
  });

  it('returns null when the first group has no models', () => {
    expect(firstAvailableModelId([{ provider: openai, status: 'configured', models: [] }])).toBeNull();
  });
});

describe('modelSubtitle', () => {
  it("prefixes the provider label when the hint doesn't already start with it", () => {
    const unprefixed: ModelOption = { id: 'm', label: 'M', hint: '4K, native multimodal', providerId: 'openai' };
    expect(modelSubtitle({ model: unprefixed, group: { provider: openai, status: 'configured', models: [unprefixed] } })).toBe(
      'OpenAI · 4K, native multimodal',
    );
  });

  it('uses the hint verbatim when it already opens with the provider label (case-insensitively)', () => {
    expect(modelSubtitle({ model: gpt5, group: { provider: openai, status: 'configured', models: [gpt5] } })).toBe(
      'OpenAI · flagship',
    );
  });

  it('uses the hint verbatim when it already opens with the provider label', () => {
    const hintedModel: ModelOption = { id: 'm', label: 'M', hint: 'openai flagship pricing', providerId: 'openai' };
    expect(modelSubtitle({ model: hintedModel, group: { provider: openai, status: 'configured', models: [hintedModel] } })).toBe(
      'openai flagship pricing',
    );
  });

  it('falls back to the provider label alone when the model has no hint', () => {
    const noHint: ModelOption = { id: 'm', label: 'M', providerId: 'openai' };
    expect(modelSubtitle({ model: noHint, group: { provider: openai, status: 'configured', models: [noHint] } })).toBe('OpenAI');
  });
});

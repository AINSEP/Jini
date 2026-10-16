import { describe, expect, it } from 'vitest';
import { pickerModelOptions } from '../rules.js';
import type { AgentModelOption } from '../types.js';

describe('pickerModelOptions', () => {
  it('collapses the live Claude alias evidence into four exact model choices', () => {
    // parseClaudeInitializeMetadata keeps the resolved default plus both alias and concrete
    // evidence for each picker row. The picker must keep the default's position, not its raw label.
    const models: readonly AgentModelOption[] = [
      { id: 'claude-opus-5-5', label: 'claude-opus-5-5', identityKind: 'concrete' },
      { id: 'opus', label: 'Opus 5.5', identityKind: 'alias', resolvedId: 'claude-opus-5-5' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', identityKind: 'concrete' },
      { id: 'fable', label: 'Fable 5.1', identityKind: 'alias', resolvedId: 'claude-fable-5-1' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1', identityKind: 'concrete' },
      { id: 'sonnet', label: 'Sonnet 5.5', identityKind: 'alias', resolvedId: 'claude-sonnet-5-5' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', identityKind: 'concrete' },
      { id: 'haiku', label: 'Haiku 5.5', identityKind: 'alias', resolvedId: 'claude-haiku-5-5' },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5', identityKind: 'concrete' },
    ];
    models.forEach(Object.freeze);
    Object.freeze(models);

    expect(pickerModelOptions({ models }).map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    ]);
  });

  it.each([false, true])('prefers the human label with humanFirst=%s', (humanFirst) => {
    const human: AgentModelOption = {
      id: 'fable', label: 'Fable 5.1', identityKind: 'alias', resolvedId: 'claude-fable-5-1',
    };
    const raw: AgentModelOption = {
      id: 'claude-fable-5-1', label: 'claude-fable-5-1', identityKind: 'concrete',
    };
    const models = humanFirst ? [human, raw] : [raw, human];

    expect(pickerModelOptions({ models }).map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    ]);
  });

  it.each([false, true])('uses a concrete human label over a raw alias label with humanFirst=%s', (humanFirst) => {
    const human: AgentModelOption = {
      id: 'claude-fable-5-1', label: 'Fable 5.1', identityKind: 'concrete',
    };
    const raw: AgentModelOption = {
      id: 'fable', label: 'fable', identityKind: 'alias', resolvedId: 'claude-fable-5-1',
    };

    expect(pickerModelOptions({ models: humanFirst ? [human, raw] : [raw, human] })
      .map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    ]);
  });

  it('keeps aliases without resolution evidence', () => {
    const models: readonly AgentModelOption[] = [
      { id: 'fable', label: 'Fable', identityKind: 'alias' },
    ];
    expect(pickerModelOptions({ models })).toEqual(models);
  });

  it('preserves lists without identity metadata, including reasoning data', () => {
    const models: readonly AgentModelOption[] = [
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'gpt-example', label: 'GPT Example', reasoning: [{ id: 'high', label: 'High' }] },
      { id: 'custom', label: 'custom', resolvedId: 'must-not-be-used' },
    ];
    expect(pickerModelOptions({ models })).toEqual(models);
  });

  it('dedupes plain IDs while preserving the first position and human label', () => {
    const models = [
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' },
      { id: 'first', label: 'Another label' },
    ];
    expect(pickerModelOptions({ models })).toEqual(models.slice(0, 2));
  });

  it('preserves routing modes and treats context variants as distinct IDs', () => {
    const models: readonly AgentModelOption[] = [
      { id: 'auto', label: 'Auto', identityKind: 'routing-mode', resolvedId: 'claude-opus-5-5' },
      { id: 'opus', label: 'Opus 5.5', identityKind: 'alias', resolvedId: 'claude-opus-5-5' },
      { id: 'opus[1m]', label: 'Opus 5.5 (1M)', identityKind: 'alias', resolvedId: 'claude-opus-5-5[1m]' },
      { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5 (1M)', identityKind: 'concrete' },
    ];
    const choices = pickerModelOptions({ models });

    expect(choices.map(({ id }) => id)).toEqual(['auto', 'claude-opus-5-5', 'claude-opus-5-5[1m]']);
    expect(choices[0]).toEqual(models[0]);
  });

  it('returns an empty list for an empty catalog', () => {
    expect(pickerModelOptions({ models: [] })).toEqual([]);
  });
});

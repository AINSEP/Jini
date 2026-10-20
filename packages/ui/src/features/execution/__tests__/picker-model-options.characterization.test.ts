import { describe, expect, it } from 'vitest';
import { pickerModelOptions } from '../rules.js';
import type { AgentModelOption } from '../types.js';

describe('pickerModelOptions characterization', () => {
  it('returns no choices for an empty catalog', () => {
    expect(pickerModelOptions({ models: [] })).toEqual([]);
  });

  it.each<AgentModelOption>([
    { id: 'alias', label: 'Alias', identityKind: 'alias' },
    { id: 'alias', label: 'alias', identityKind: 'alias', resolvedId: '' },
    { id: 'plain', label: 'plain', resolvedId: 'ignored' },
    { id: 'concrete', label: 'Concrete', identityKind: 'concrete', resolvedId: 'ignored' },
    { id: 'auto', label: 'Auto', identityKind: 'routing-mode', resolvedId: 'ignored' },
  ])('preserves the original row for $id without usable alias resolution', (model) => {
    Object.freeze(model);
    const models = Object.freeze([model]);
    expect(pickerModelOptions({ models })).toEqual([model]);
    expect(pickerModelOptions({ models })[0]).toBe(model);
  });

  it.each([
    ['alias', 'target'],
    ['Friendly name', 'Friendly name'],
  ])('normalizes a resolved alias label %s to %s without mutating the evidence', (label, expectedLabel) => {
    const model: AgentModelOption = Object.freeze({
      id: 'alias', label, identityKind: 'alias', resolvedId: 'target',
      reasoning: Object.freeze([{ id: 'high', label: 'High' }]),
    });
    expect(pickerModelOptions({ models: Object.freeze([model]) })).toEqual([{
      ...model, id: 'target', label: expectedLabel, identityKind: 'concrete',
    }]);
    expect(model.id).toBe('alias');
    expect(model.label).toBe(label);
    expect(model.identityKind).toBe('alias');
  });

  it('upgrades only the first raw label while retaining its position and reasoning metadata', () => {
    const first: AgentModelOption = Object.freeze({
      id: 'target', label: 'target', identityKind: 'concrete',
      reasoning: Object.freeze([{ id: 'low', label: 'Low' }]),
    });
    const second: AgentModelOption = Object.freeze({ id: 'other', label: 'Other' });
    const models: readonly AgentModelOption[] = Object.freeze([
      first, second,
      Object.freeze({ id: 'target', label: 'target' }),
      Object.freeze({ id: 'alias', label: 'Human label', identityKind: 'alias', resolvedId: 'target', reasoning: [] }),
      Object.freeze({ id: 'target', label: 'Later human label', reasoning: [] }),
      Object.freeze({ id: 'target', label: 'target' }),
    ]);
    const result = pickerModelOptions({ models });
    expect(result).toEqual([{ ...first, label: 'Human label' }, second]);
    expect(result[1]).toBe(second);
    expect(first.label).toBe('target');
  });

  it('keeps resolved alias metadata when a later concrete row supplies the human label', () => {
    const alias: AgentModelOption = Object.freeze({
      id: 'alias', label: 'alias', identityKind: 'alias', resolvedId: 'target', reasoning: [],
    });
    const models: readonly AgentModelOption[] = Object.freeze([
      alias,
      Object.freeze({ id: 'target', label: 'Human label', reasoning: [{ id: 'high', label: 'High' }] }),
    ]);
    expect(pickerModelOptions({ models })).toEqual([{
      id: 'target', label: 'Human label', identityKind: 'concrete', resolvedId: 'target', reasoning: [],
    }]);
  });
});

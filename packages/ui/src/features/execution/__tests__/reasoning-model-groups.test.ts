import { describe, expect, it } from 'vitest';
import {
  modelIdForReasoningLevel,
  reasoningModelGroupFor,
  reasoningModelGroups,
  splitReasoningModelId,
} from '../rules.js';
import type { AgentModelOption } from '../types.js';

/**
 * @file The per-base-model reasoning-effort derivation for runtimes that encode effort INSIDE the
 * model id (`RuntimeAgentDef.reasoningInModelId`; antigravity is the only declarer today).
 *
 * The whole reason this is derived rather than declared is in the fixture below, which is `agy
 * models`' real live output (agy v1.1.25, captured 2026-09-02): **the effort levels are not uniform
 * across base models.** A fixed high/medium/low control would offer `gemini-3.1-pro-medium`, which
 * does not exist and which `agy --model` rejects outright with `Error: invalid model selection`.
 * Every case below is one of the four ways that fixed control would have been wrong.
 */

/** `agy models`' real output, as `parseAgyModels` hands it to the picker (synthetic `default` row
 *  first, exactly as `DEFAULT_MODEL_OPTION` prepends it). */
const AGY_MODELS: readonly AgentModelOption[] = [
  { id: 'default', label: 'Default (CLI config)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
  { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
  { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

/** The vocabulary antigravity's def declares, in its declared display order. */
const LEVELS: readonly AgentModelOption[] = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const LEVEL_IDS = LEVELS.map((level) => level.id);

function groupFor(baseId: string) {
  const group = reasoningModelGroups(AGY_MODELS, LEVELS).find((candidate) => candidate.baseId === baseId);
  if (!group) throw new Error(`no group derived for base '${baseId}'`);
  return group;
}

describe('splitReasoningModelId', () => {
  it('splits a recognized effort suffix off the base id', () => {
    expect(splitReasoningModelId('gemini-3.1-pro-high', LEVEL_IDS)).toEqual({
      baseId: 'gemini-3.1-pro',
      level: 'high',
    });
  });

  // The trap this guards: `-thinking` LOOKS like a modifier suffix and is not an effort level.
  // Reading it as one would invent a base id of `claude-opus-4-6` that has no variants at all,
  // and an effort level `thinking` that no control can render.
  it('leaves a trailing token that is not in the declared vocabulary as part of the base id', () => {
    expect(splitReasoningModelId('claude-opus-4-6-thinking', LEVEL_IDS)).toEqual({
      baseId: 'claude-opus-4-6-thinking',
      level: null,
    });
  });

  it('returns a suffix-less id unchanged, with no level', () => {
    expect(splitReasoningModelId('claude-sonnet-4-6', LEVEL_IDS)).toEqual({
      baseId: 'claude-sonnet-4-6',
      level: null,
    });
    expect(splitReasoningModelId('default', LEVEL_IDS)).toEqual({ baseId: 'default', level: null });
  });

  it('treats an empty id as its own bare base rather than throwing', () => {
    expect(splitReasoningModelId('', LEVEL_IDS)).toEqual({ baseId: '', level: null });
  });

  // A level id that is the WHOLE model id has no base to split off — splitting it would produce
  // an empty base id and silently merge every such entry into one group.
  it('does not split when the level suffix would leave an empty base id', () => {
    expect(splitReasoningModelId('high', LEVEL_IDS)).toEqual({ baseId: 'high', level: null });
  });

  it('recognizes no suffix at all when the declared vocabulary is empty', () => {
    expect(splitReasoningModelId('gemini-3.1-pro-high', [])).toEqual({
      baseId: 'gemini-3.1-pro-high',
      level: null,
    });
  });
});

describe('reasoningModelGroups over the real agy catalog', () => {
  it('collapses the 15 rows into one group per base model, in first-appearance order', () => {
    expect(reasoningModelGroups(AGY_MODELS, LEVELS).map((group) => group.baseId)).toEqual([
      'default',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.1-pro',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b',
    ]);
  });

  // THE case this whole mechanism exists for. A fixed high/medium/low dropdown would offer
  // `gemini-3.1-pro-medium`; `agy --model` rejects it.
  it('gives gemini-3.1-pro exactly high and low, and NOT medium', () => {
    const group = groupFor('gemini-3.1-pro');
    expect(group.levels.map((level) => level.id)).toEqual(['high', 'low']);
    expect(group.levels.map((level) => level.id)).not.toContain('medium');
    expect(group.modelIdByLevel).toEqual({
      high: 'gemini-3.1-pro-high',
      low: 'gemini-3.1-pro-low',
    });
    expect(group.modelIdByLevel['medium']).toBeUndefined();
  });

  it('gives a base with all three variants all three, in the declared vocabulary order', () => {
    expect(groupFor('gemini-3.8-flash').levels.map((level) => level.id)).toEqual(['high', 'medium', 'low']);
  });

  it('gives gpt-oss-120b only medium, so the control cannot offer a level that does not exist', () => {
    const group = groupFor('gpt-oss-120b');
    expect(group.levels.map((level) => level.id)).toEqual(['medium']);
    expect(group.modelIdByLevel).toEqual({ medium: 'gpt-oss-120b-medium' });
  });

  it('gives claude-sonnet-4-6 no effort options at all, and records it as a bare model id', () => {
    const group = groupFor('claude-sonnet-4-6');
    expect(group.levels).toEqual([]);
    expect(group.bareModelId).toBe('claude-sonnet-4-6');
  });

  it('does not read -thinking as an effort level', () => {
    const group = groupFor('claude-opus-4-6-thinking');
    expect(group.levels).toEqual([]);
    expect(group.bareModelId).toBe('claude-opus-4-6-thinking');
    expect(reasoningModelGroups(AGY_MODELS, LEVELS).map((g) => g.baseId)).not.toContain('claude-opus-4-6');
  });

  it('keeps the synthetic default row as its own bare group', () => {
    const group = groupFor('default');
    expect(group.levels).toEqual([]);
    expect(group.bareModelId).toBe('default');
    expect(group.label).toBe('Default (CLI config)');
  });

  // The base picker must not read "Gemini 3.1 Pro (High)" as the name of the BASE model.
  it('strips the effort qualifier from a base label, and only when the id carried a real suffix', () => {
    expect(groupFor('gemini-3.1-pro').label).toBe('Gemini 3.1 Pro');
    expect(groupFor('gpt-oss-120b').label).toBe('GPT-OSS 120B');
    // `(Thinking)` is not an effort qualifier and the id carried no suffix, so it survives.
    expect(groupFor('claude-sonnet-4-6').label).toBe('Claude Sonnet 4.6 (Thinking)');
    expect(groupFor('claude-opus-4-6-thinking').label).toBe('Claude Opus 4.6 (Thinking)');
  });

  it('derives nothing when the declared vocabulary is empty, leaving every id its own base', () => {
    expect(reasoningModelGroups(AGY_MODELS, []).map((group) => group.baseId)).toEqual(
      AGY_MODELS.map((model) => model.id),
    );
  });

  it('returns no groups for an empty model list', () => {
    expect(reasoningModelGroups([], LEVELS)).toEqual([]);
  });
});

describe('reasoningModelGroupFor', () => {
  it('finds the group a full suffixed model id belongs to', () => {
    const groups = reasoningModelGroups(AGY_MODELS, LEVELS);
    expect(reasoningModelGroupFor(groups, 'gemini-3.1-pro-low', LEVEL_IDS)?.baseId).toBe('gemini-3.1-pro');
    expect(reasoningModelGroupFor(groups, 'claude-sonnet-4-6', LEVEL_IDS)?.baseId).toBe('claude-sonnet-4-6');
  });

  it('returns null for an id from a different (or stale) catalog rather than guessing a group', () => {
    const groups = reasoningModelGroups(AGY_MODELS, LEVELS);
    expect(reasoningModelGroupFor(groups, 'gemini-9.9-pro-high', LEVEL_IDS)).toBeNull();
    expect(reasoningModelGroupFor(groups, '', LEVEL_IDS)).toBeNull();
  });
});

describe('modelIdForReasoningLevel', () => {
  const ALL_IDS = new Set(AGY_MODELS.map((model) => model.id));

  it('recombines base + level back into a slug that really exists in the catalog', () => {
    for (const group of reasoningModelGroups(AGY_MODELS, LEVELS)) {
      for (const level of group.levels) {
        const recombined = modelIdForReasoningLevel(group, level.id);
        expect(ALL_IDS.has(recombined)).toBe(true);
        expect(splitReasoningModelId(recombined, LEVEL_IDS)).toEqual({ baseId: group.baseId, level: level.id });
      }
    }
  });

  // Switching base while a level is carried over from the previous base: `medium` is a real level
  // in the vocabulary but not one gemini-3.1-pro has, so the request must land on a level that
  // base really offers rather than composing the non-existent slug.
  it('falls back to the base first available level when the carried-over level does not exist for it', () => {
    const recombined = modelIdForReasoningLevel(groupFor('gemini-3.1-pro'), 'medium');
    expect(recombined).toBe('gemini-3.1-pro-high');
    expect(ALL_IDS.has(recombined)).toBe(true);
    expect(recombined).not.toBe('gemini-3.1-pro-medium');
  });

  it('returns the bare model id for a base with no effort variants, whatever level is asked for', () => {
    expect(modelIdForReasoningLevel(groupFor('claude-sonnet-4-6'), 'high')).toBe('claude-sonnet-4-6');
    expect(modelIdForReasoningLevel(groupFor('claude-opus-4-6-thinking'), null)).toBe('claude-opus-4-6-thinking');
    expect(modelIdForReasoningLevel(groupFor('default'), 'low')).toBe('default');
  });

  it('returns the first available level when no level is requested at all', () => {
    expect(modelIdForReasoningLevel(groupFor('gemini-3.8-flash'), null)).toBe('gemini-3.8-flash-high');
  });
});

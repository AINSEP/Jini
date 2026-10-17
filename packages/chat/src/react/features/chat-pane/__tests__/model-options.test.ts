import { describe, expect, it } from 'vitest';
import { configuredPickerModel, pickerCatalogNote, pickerModelLabel, pickerModelOptions, pickerModelValue } from '../model-options.js';
import { defaultChatPaneSelection, resolveChatPaneSelection } from '../rules.js';
import type { ChatPaneAgent } from '../types.js';
const agent: ChatPaneAgent = { id: 'codex', name: 'Codex', available: true,
  models: [{ id: 'default', label: 'Default (CLI config)' }, { id: 'gpt-new', label: 'GPT New', identityKind: 'concrete' }, { id: 'gpt-other', label: 'GPT Other' }],
  modelCatalog: { source: 'cli', freshness: 'fresh', fetchedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-10-06T00:15:00.000Z', coverage: 'account', launchFingerprint: 'scope' },
  defaultModelResolution: { status: 'resolved', id: 'gpt-other', source: 'config-file', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'scope' } };
describe('concrete starting-model choices', () => {
  it('translates picker copy through the host locale without translating model names or timestamps', () => {
    // Chat supports arbitrary host locales through I18nAdapter, with no packaged dictionaries.
    const dictionaries = {
      es: { 'Choose model': 'Elegir modelo', Cached: 'En caché', 'Offline fallback': 'Alternativa sin conexión' },
      ja: { 'Choose model': 'モデルを選択', Cached: 'キャッシュ', 'Offline fallback': 'オフラインの代替' },
    };
    for (const dictionary of Object.values(dictionaries)) {
      const t = (key: string) => dictionary[key as keyof typeof dictionary] || key;
      expect(pickerModelLabel(undefined, undefined, t)).toBe(dictionary['Choose model']);
      expect(pickerModelLabel({ ...agent, defaultModelResolution: { status: 'unresolved', reason: 'missing' } }, undefined, t)).toBe(dictionary['Choose model']);
      expect(pickerModelLabel(agent, 'gpt-new', t)).toBe('GPT New');
      expect(pickerCatalogNote({ ...agent, modelCatalog: { ...agent.modelCatalog!, freshness: 'stale' } }, t)).toBe(`${dictionary.Cached} · 2026-10-06T00:00:00.000Z`);
      expect(pickerCatalogNote({ ...agent, modelCatalog: { ...agent.modelCatalog!, freshness: 'offline-fallback' } }, t)).toBe(dictionary['Offline fallback']);
      expect(pickerCatalogNote({ id: 'host', name: 'Host', models: agent.models! }, t)).toBe(dictionary['Offline fallback']);
    }
  });
  it('preselects the CLI configured concrete entry using its display name without a Default prefix', () => {
    expect(defaultChatPaneSelection({ agent })).toEqual({ agentId: 'codex', model: 'gpt-other' });
    expect(configuredPickerModel(agent)).toBe('gpt-other');
    expect(pickerModelLabel(agent, 'default')).toBe('GPT Other');
    expect(pickerModelOptions(agent).map((row) => row.id)).toEqual(['gpt-new', 'gpt-other']);
  });
  it('uses the id when no catalog display name exists', () => {
    expect(pickerModelLabel({ ...agent, models: [] })).toBe('gpt-other');
  });
  it('keeps each live Claude concrete id in its first position with its human label', () => {
    // The CLI default arrives before the alias and concrete rows that carry its display name.
    const claude: ChatPaneAgent = { ...agent, id: 'claude', name: 'Claude', models: [
      { id: 'claude-opus-5-5', label: 'claude-opus-5-5', identityKind: 'concrete' },
      { id: 'opus', label: 'Opus 5.5', identityKind: 'alias', resolvedId: 'claude-opus-5-5' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', identityKind: 'concrete' },
      { id: 'fable', label: 'Fable 5.1', identityKind: 'alias', resolvedId: 'claude-fable-5-1' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1', identityKind: 'concrete' },
      { id: 'sonnet', label: 'Sonnet 5.5', identityKind: 'alias', resolvedId: 'claude-sonnet-5-5' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', identityKind: 'concrete' },
    ], defaultModelResolution: { status: 'resolved', id: 'claude-opus-5-5', source: 'cli', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'scope' } };
    claude.models!.forEach(Object.freeze);
    Object.freeze(claude.models);
    expect(pickerModelOptions(claude).map(row => ({ id: row.id, label: row.label }))).toEqual([
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    ]);
    expect(pickerModelLabel(claude, 'default')).toBe('Opus 5.5');
    expect(defaultChatPaneSelection({ agent: claude })).toEqual({ agentId: 'claude', model: 'claude-opus-5-5' });
    const { defaultModelResolution: _defaultModelResolution, ...claudeWithoutDefault } = claude;
    expect(defaultChatPaneSelection({ agent: claudeWithoutDefault })).toEqual({ agentId: 'claude', model: 'claude-opus-5-5' });
    expect(pickerModelValue(claude, 'default')).toBe('claude-opus-5-5');
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5']) {
      expect(pickerModelValue(claude, model)).toBe(model);
      expect(resolveChatPaneSelection({ agents: [claude], requested: { agentId: 'claude', model } })).toEqual({ agentId: 'claude', model });
    }
    expect(resolveChatPaneSelection({ agents: [claude], requested: { agentId: 'claude', model: 'unknown' } })).toEqual({ agentId: 'claude', model: 'claude-opus-5-5' });
  });
  it('keeps a human label when a later duplicate has only the raw id', () => {
    const humanFirst = { ...agent, models: [
      { id: 'gpt-other', label: 'GPT Other' },
      { id: 'gpt-other', label: 'gpt-other' },
    ] };
    expect(pickerModelOptions(humanFirst).map(row => ({ id: row.id, label: row.label }))).toEqual([
      { id: 'gpt-other', label: 'GPT Other' },
    ]);
  });
  it('never upgrades a raw-id label to a legacy Default label from a duplicate', () => {
    const legacyDuplicate = { ...agent, models: [
      { id: 'gpt-other', label: 'gpt-other' },
      { id: 'gpt-other', label: 'Default (recommended)' },
      { id: 'default', label: 'Recommended', resolvedId: 'gpt-other' },
    ] };
    expect(pickerModelOptions(legacyDuplicate).map(row => ({ id: row.id, label: row.label }))).toEqual([
      { id: 'gpt-other', label: 'gpt-other' },
    ]);
    expect(pickerModelLabel(legacyDuplicate, 'default')).toBe('gpt-other');
  });
  it('replaces legacy Default labels with the resolved concrete ID', () => {
    const legacy = { ...agent, models: [
      { id: 'default', label: 'Default (recommended)', resolvedId: 'gpt-other' },
      { id: 'gpt-new', label: 'Default (CLI config)' },
    ] };
    expect(pickerModelOptions(legacy).map(row => ({ id: row.id, label: row.label }))).toEqual([
      { id: 'gpt-other', label: 'gpt-other' }, { id: 'gpt-new', label: 'gpt-new' },
    ]);
    expect(pickerModelLabel(legacy, 'default')).toBe('gpt-other');
  });
  it('does not offer unresolved aliases or routing modes and requires a concrete selection', () => {
    const routed: ChatPaneAgent = { ...agent, models: [{ id: 'auto', label: 'Auto', identityKind: 'routing-mode' }, { id: 'adaptive', label: 'Adaptive' }, { id: 'sonnet', label: 'Sonnet', identityKind: 'alias' }], defaultModelResolution: { status: 'unresolved', selectionId: 'auto', reason: 'No concrete evidence' } };
    expect(pickerModelOptions(routed)).toEqual([]);
    expect(defaultChatPaneSelection({ agent: routed })).toEqual({ agentId: 'codex' });
    expect(pickerModelLabel(routed)).toBe('Choose model');
    expect(defaultChatPaneSelection({ agent: { ...routed, models: [{ id: 'gpt-new', label: 'GPT New' }] } })).toEqual({ agentId: 'codex' });
    expect(pickerModelOptions({ ...routed, models: [{ id: 'opus[1m]', label: 'Unresolved variant' }] })).toEqual([]);
  });
  it('resolves alias options to the concrete ID that is passed in selection', () => {
    const aliased = { ...agent, models: [{ id: 'opus', label: 'Claude Opus New', identityKind: 'alias' as const, resolvedId: 'claude-opus-new' }] };
    expect(pickerModelOptions(aliased).map((row) => row.id)).toEqual(['gpt-other', 'claude-opus-new']);
    expect(resolveChatPaneSelection({ agents: [aliased], requested: { agentId: 'codex', model: 'claude-opus-new' } })).toEqual({ agentId: 'codex', model: 'claude-opus-new' });
  });
  it('shows freshness separately from the exact model name', () => {
    expect(pickerCatalogNote(agent)).toBeUndefined();
    expect(pickerCatalogNote({ ...agent, modelCatalog: { ...agent.modelCatalog!, freshness: 'stale' } })).toBe('Cached · 2026-10-06T00:00:00.000Z');
    expect(pickerCatalogNote({ ...agent, modelCatalog: { ...agent.modelCatalog!, freshness: 'offline-fallback' } })).toBe('Offline fallback');
  });
  it('does not select the retired CLI from an old browser snapshot', () => {
    expect(resolveChatPaneSelection({ agents: [{ id: 'gemini', name: 'Retired' }, agent], requested: { agentId: 'gemini' } })).toEqual({ agentId: 'codex', model: 'gpt-other' });
  });
  it('hides public model IDs that cannot pin the built-in agent', () => {
    expect(pickerModelOptions({ ...agent, supportsConcreteModelSelection: false })).toEqual([]);
  });
});

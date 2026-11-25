import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_ASSISTANT_RUNTIME_PREFERENCES, PREFER_SUBAGENTS_KEY, REPLY_LENGTH_KEY, USE_CLAUDE_IN_CHROME_KEY, visibleAssistantRuntimePreferences,
  loadAssistantRuntimePreferences, readAssistantRuntimePreferences, saveAssistantRuntimePreferences,
} from '../assistant-runtime-preferences.js';

describe('person-scoped assistant runtime preferences', () => {
  it('mirrors the server keys and defaults', () => {
    expect(PREFER_SUBAGENTS_KEY).toBe('preferSubagents');
    expect(REPLY_LENGTH_KEY).toBe('replyLength');
    expect(USE_CLAUDE_IN_CHROME_KEY).toBe('useClaudeInChrome');
    expect(DEFAULT_ASSISTANT_RUNTIME_PREFERENCES).toEqual({ preferSubagents: true, useClaudeInChrome: false, replyLength: 'normal' });
  });
  it('reads booleans and falls back to the default for missing or invalid values', () => {
    expect(readAssistantRuntimePreferences({ values: new Map() })).toEqual({ preferSubagents: true, useClaudeInChrome: false, replyLength: 'normal' });
    expect(readAssistantRuntimePreferences({ values: new Map<string, unknown>([['preferSubagents', 'no'], ['useClaudeInChrome', 'yes']]) })).toEqual({ preferSubagents: true, useClaudeInChrome: false, replyLength: 'normal' });
    expect(readAssistantRuntimePreferences({ values: new Map([['preferSubagents', false], ['useClaudeInChrome', true]]) })).toEqual({ preferSubagents: false, useClaudeInChrome: true, replyLength: 'normal' });
  });
  it('loads through the shared ledger namespace', async () => {
    const port = { load: vi.fn(async () => new Map<string, unknown>([['preferSubagents', false]])), save: vi.fn(async () => {}) };
    expect(await loadAssistantRuntimePreferences({ port }, {})).toEqual({ preferSubagents: false, useClaudeInChrome: false, replyLength: 'normal' });
    expect(port.load).toHaveBeenCalledWith({ namespace: 'core.interface' }, {});
  });
  it('saves at user scope, marking only the changed keys', async () => {
    const port = { load: vi.fn(), save: vi.fn(async () => {}) };
    await saveAssistantRuntimePreferences({ port, next: { preferSubagents: false, useClaudeInChrome: false, replyLength: 'normal' }, previous: { preferSubagents: true, useClaudeInChrome: false, replyLength: 'normal' } }, {});
    expect(port.save).toHaveBeenCalledWith({ namespace: 'core.interface', scope: 'user', candidates: [
      { key: 'preferSubagents', valueJson: false, changed: true }, { key: 'useClaudeInChrome', valueJson: false, changed: false }, { key: 'replyLength', valueJson: 'normal', changed: false },
    ] }, {});
    await saveAssistantRuntimePreferences({ port, next: { preferSubagents: true, useClaudeInChrome: true, replyLength: 'normal' }, previous: { preferSubagents: true, useClaudeInChrome: false, replyLength: 'normal' } }, {});
    expect(port.save).toHaveBeenLastCalledWith({ namespace: 'core.interface', scope: 'user', candidates: [
      { key: 'preferSubagents', valueJson: true, changed: false }, { key: 'useClaudeInChrome', valueJson: true, changed: true }, { key: 'replyLength', valueJson: 'normal', changed: false },
    ] }, {});
  });
  it('shows a toggle only for a runtime that declares support for it', () => {
    expect(visibleAssistantRuntimePreferences({ agent: { supportsSubagents: true, supportsClaudeInChrome: true } })).toEqual({ preferSubagents: true, useClaudeInChrome: true, replyLength: true });
    expect(visibleAssistantRuntimePreferences({ agent: { supportsSubagents: false } })).toEqual({ preferSubagents: false, useClaudeInChrome: false, replyLength: true });
    expect(visibleAssistantRuntimePreferences({ agent: undefined })).toEqual({ preferSubagents: false, useClaudeInChrome: false, replyLength: true });
  });
});

describe('reply length', () => {
  it.each(['short', 'normal', 'detailed'] as const)('reads %s from the ledger', replyLength => {
    expect(readAssistantRuntimePreferences({ values: new Map([['replyLength', replyLength]]) }).replyLength).toBe(replyLength);
  });
  it.each([undefined, null, true, 1, '', 'SHORT', 'verbose', {}])('defaults invalid value %j to Normal', replyLength => {
    expect(readAssistantRuntimePreferences({ values: new Map([['replyLength', replyLength]]) }).replyLength).toBe('normal');
  });
  it('saves only the reply-length difference and can reset to Normal', async () => {
    const port = { load: vi.fn(), save: vi.fn(async () => {}) };
    const normal = DEFAULT_ASSISTANT_RUNTIME_PREFERENCES;
    const short = { ...normal, replyLength: 'short' as const };
    for (const [previous, next] of [[normal, short], [short, normal]] as const) {
      await saveAssistantRuntimePreferences({ port, previous, next }, {});
      expect(port.save).toHaveBeenLastCalledWith({ namespace: 'core.interface', scope: 'user', candidates: [
        { key: 'preferSubagents', valueJson: true, changed: false },
        { key: 'useClaudeInChrome', valueJson: false, changed: false },
        { key: 'replyLength', valueJson: next.replyLength, changed: true },
      ] }, {});
    }
  });
});

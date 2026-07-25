import { describe, expect, it } from 'vitest';

import {
  MAX_AGENT_LABEL_LENGTH,
  describeFieldRefusal,
  findFieldFillRefusal,
  normalizeAgentLabel,
} from '../../agentic/index.js';

describe('findFieldFillRefusal', () => {
  it('allows a field whose autocomplete is present but harmless', () => {
    // The loop must fall through when every token is benign, rather than only being exercised
    // by the absent-autocomplete path.
    expect(findFieldFillRefusal({ type: 'text', autocomplete: 'off' })).toBeNull();
    expect(findFieldFillRefusal({ type: 'text', autocomplete: 'section-a given-name' })).toBeNull();
  });

  it('allows an ordinary text field', () => {
    expect(findFieldFillRefusal({ type: 'text', name: 'task' })).toBeNull();
    expect(findFieldFillRefusal({})).toBeNull();
  });

  it('refuses credential, payment and one-time-code fields', () => {
    expect(findFieldFillRefusal({ type: 'password' })).toBe('denied-type');
    expect(findFieldFillRefusal({ type: 'PASSWORD' })).toBe('denied-type');
    expect(findFieldFillRefusal({ type: 'hidden' })).toBe('denied-type');
    expect(findFieldFillRefusal({ type: 'file' })).toBe('denied-type');
    expect(findFieldFillRefusal({ type: 'text', autocomplete: 'cc-number' })).toBe('denied-autocomplete');
    expect(findFieldFillRefusal({ type: 'text', autocomplete: 'section-a cc-csc' })).toBe('denied-autocomplete');
    expect(findFieldFillRefusal({ type: 'text', autocomplete: 'one-time-code' })).toBe('denied-autocomplete');
  });

  it('refuses a secret-looking field even when type and autocomplete are innocent', () => {
    // The case an allowlist alone misses: the field carries a handle and looks like plain text.
    expect(findFieldFillRefusal({ type: 'text', name: 'csrf_token' })).toBe('suspicious-name');
    expect(findFieldFillRefusal({ type: 'text', id: 'user-apikey' })).toBe('suspicious-name');
    expect(findFieldFillRefusal({ type: 'text', name: 'card-number' })).toBeNull();
    expect(findFieldFillRefusal({ type: 'text', name: 'cardnumber' })).toBe('suspicious-name');
  });

  it('refuses fields the user could not type into either', () => {
    expect(findFieldFillRefusal({ type: 'text', readOnly: true })).toBe('read-only');
    expect(findFieldFillRefusal({ type: 'text', disabled: true })).toBe('disabled');
  });

  it('describes every refusal it can return', () => {
    const refusals = [
      findFieldFillRefusal({ type: 'password' }),
      findFieldFillRefusal({ autocomplete: 'cc-exp' }),
      findFieldFillRefusal({ name: 'secret' }),
      findFieldFillRefusal({ readOnly: true }),
      findFieldFillRefusal({ disabled: true }),
    ];
    for (const refusal of refusals) {
      expect(refusal).not.toBeNull();
      expect(describeFieldRefusal(refusal!).length).toBeGreaterThan(5);
    }
  });
});

describe('normalizeAgentLabel', () => {
  it('collapses whitespace and reports untruncated text', () => {
    expect(normalizeAgentLabel('  Water   the\n window plants ')).toEqual({
      text: 'Water the window plants',
      truncated: false,
    });
  });

  it('strips control characters and bidirectional overrides', () => {
    // U+202E flips rendering order, so page text can read differently from how it displays.
    const hostile = 'Delete\u202Eaccount\u0007 \u200B now';
    const { text } = normalizeAgentLabel(hostile);
    expect(text).not.toMatch(/[\u0000-\u001F\u200B-\u200F\u202A-\u202E]/);
    expect(text).toBe('Delete account now');
  });

  it('caps long labels and flags the truncation', () => {
    const long = 'a'.repeat(MAX_AGENT_LABEL_LENGTH + 50);
    const result = normalizeAgentLabel(long);
    expect(result.text).toHaveLength(MAX_AGENT_LABEL_LENGTH);
    expect(result.truncated).toBe(true);
  });

  it('honors a custom cap', () => {
    expect(normalizeAgentLabel('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
  });
});

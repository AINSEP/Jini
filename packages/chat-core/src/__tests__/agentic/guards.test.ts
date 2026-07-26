import { describe, expect, it } from 'vitest';

import {
  MAX_AGENT_LABEL_LENGTH,
  describeFieldReadRefusal,
  describeFieldRefusal,
  findFieldFillRefusal,
  findFieldReadRefusal,
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
    expect(findFieldFillRefusal({ type: 'text', name: 'cardnumber' })).toBe('suspicious-name');
  });

  it('sees through the separator a field name happens to use', () => {
    // These are the same field under three conventions, and the guard has to agree about all
    // three. It previously matched only the run-together spelling, which is the rarest one.
    for (const name of ['card-number', 'card_number', 'cardNumber']) {
      expect(findFieldFillRefusal({ type: 'text', name })).toBe('suspicious-name');
    }
    for (const name of ['api_key', 'api-key', 'apiKey', 'credit_card', 'one.time.otp']) {
      expect(findFieldFillRefusal({ type: 'text', name })).toBe('suspicious-name');
    }
    // Squashing separators must not start refusing ordinary fields.
    for (const name of ['full-name', 'work_email', 'teamSize', 'street-address']) {
      expect(findFieldFillRefusal({ type: 'text', name })).toBeNull();
    }
  });

  it('refuses fields the user could not type into either', () => {
    expect(findFieldFillRefusal({ type: 'text', readOnly: true })).toBe('read-only');
    expect(findFieldFillRefusal({ type: 'text', disabled: true })).toBe('disabled');
  });

  it('refuses controls that hold no text, pointing at the verb that does work', () => {
    // Filling a checkbox sets the string it submits when ticked and leaves `checked` alone — a
    // write that succeeds and accomplishes nothing, which a caller never retries.
    for (const type of ['checkbox', 'radio', 'submit', 'reset', 'button']) {
      expect(findFieldFillRefusal({ type, name: 'agree' })).toBe('not-text');
    }
    expect(describeFieldRefusal('not-text')).toMatch(/click verb/);
    // Reading one is fine — only writing is meaningless.
    expect(findFieldReadRefusal({ type: 'checkbox', name: 'agree' })).toBeNull();
  });

  it('still allows the value-bearing input types that are not plain text', () => {
    for (const type of ['range', 'color', 'date', 'time', 'number', 'select']) {
      expect(findFieldFillRefusal({ type, name: 'f' })).toBeNull();
    }
  });

  it('is the read guard plus the two refusals that are only about writing', () => {
    // Anything an agent may not read is certainly not something it may overwrite...
    expect(findFieldReadRefusal({ type: 'password' })).toBe('denied-type');
    expect(findFieldFillRefusal({ type: 'password' })).toBe('denied-type');
    // ...but read-only and disabled say nothing about whether the value is a secret, so reading
    // one back is fine. Conflating the two would hide ordinary values for no benefit.
    expect(findFieldReadRefusal({ type: 'text', readOnly: true })).toBeNull();
    expect(findFieldFillRefusal({ type: 'text', readOnly: true })).toBe('read-only');
    expect(findFieldReadRefusal({ type: 'text', disabled: true })).toBeNull();
    expect(findFieldFillRefusal({ type: 'text', disabled: true })).toBe('disabled');
  });

  it('describes every read refusal it can return, in read terms', () => {
    const refusals = [
      findFieldReadRefusal({ type: 'hidden' }),
      findFieldReadRefusal({ autocomplete: 'cc-csc' }),
      findFieldReadRefusal({ name: 'auth_token' }),
    ];
    for (const refusal of refusals) {
      expect(refusal).not.toBeNull();
      expect(describeFieldReadRefusal(refusal!).length).toBeGreaterThan(5);
    }
    expect(describeFieldReadRefusal('denied-type')).toMatch(/readable/);
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

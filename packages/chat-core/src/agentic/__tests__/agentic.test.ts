import { describe, expect, it } from 'vitest';

import {
  AGENT_ELEMENT_ATTRIBUTE,
  CHAT_CAPABILITIES,
  MAX_AGENT_LABEL_LENGTH,
  PAGE_CAPABILITIES,
  availableCapabilities,
  describeFieldRefusal,
  findCapability,
  findFieldFillRefusal,
  isValidElementHandle,
  normalizeAgentLabel,
  resolveHandleSelector,
  type CapabilityDef,
} from '../index.js';

const ALL: readonly CapabilityDef[] = [...CHAT_CAPABILITIES, ...PAGE_CAPABILITIES];

describe('capability manifests', () => {
  it('declares unique ids and a complete shape for every capability', () => {
    const ids = ALL.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of ALL) {
      expect(capability.description.length).toBeGreaterThan(20);
      expect(capability.inputSchema.type).toBe('object');
      // Advertising an open input shape invites callers to send fields nothing validates.
      expect(capability.inputSchema.additionalProperties).toBe(false);
      expect(['read', 'write']).toContain(capability.risk);
      expect(['session', 'server']).toContain(capability.surface);
    }
  });

  it('lists every required field among its declared properties', () => {
    for (const capability of ALL) {
      for (const required of capability.inputSchema.required ?? []) {
        expect(Object.keys(capability.inputSchema.properties)).toContain(required);
      }
    }
  });

  it('gates the one destructive capability behind explicit confirmation', () => {
    const confirming = ALL.filter((capability) => capability.requiresConfirmation === true);
    expect(confirming.map((capability) => capability.id)).toEqual(['chat.reset_conversation']);
    for (const capability of confirming) {
      expect(capability.inputSchema.required).toContain('confirm');
      expect(capability.inputSchema.properties['confirm']?.type).toBe('boolean');
    }
  });

  it('never marks a read capability as needing confirmation', () => {
    for (const capability of ALL) {
      if (capability.risk === 'read') expect(capability.requiresConfirmation).toBeUndefined();
    }
  });

  it('addresses page targets by handle, never by selector or script', () => {
    for (const capability of PAGE_CAPABILITIES) {
      const properties = Object.keys(capability.inputSchema.properties);
      expect(properties).not.toContain('selector');
      expect(properties).not.toContain('script');
      expect(properties).not.toContain('js');
      expect(capability.surface).toBe('session');
    }
  });
});

describe('availableCapabilities', () => {
  it('hides session-only capabilities when no frontend is connected', () => {
    const withoutSession = availableCapabilities(ALL, false);
    expect(withoutSession.every((capability) => capability.surface === 'server')).toBe(true);
    expect(withoutSession.map((capability) => capability.id)).toEqual(['chat.send_message']);
    // No page verb is reachable without a live session — that must fail closed with a distinct
    // "no eligible frontend" answer rather than hanging until a timeout.
    expect(withoutSession.some((capability) => capability.id.startsWith('page.'))).toBe(false);
  });

  it('returns everything when a session is connected', () => {
    expect(availableCapabilities(ALL, true)).toHaveLength(ALL.length);
  });
});

describe('findCapability', () => {
  it('resolves a known id and returns undefined for an unknown one', () => {
    expect(findCapability(ALL, 'page.highlight')?.risk).toBe('read');
    expect(findCapability(ALL, 'page.evaluate')).toBeUndefined();
  });
});

describe('element handles', () => {
  it('accepts the handles the sample markup publishes', () => {
    for (const handle of ['task-water-plants', 'new-task-input', 'add-task-button', 'board']) {
      expect(isValidElementHandle(handle)).toBe(true);
      expect(resolveHandleSelector(handle)).toBe(`[${AGENT_ELEMENT_ATTRIBUTE}="${handle}"]`);
    }
  });

  it('refuses anything that could escape the attribute selector', () => {
    const hostile = [
      'a"],script',          // closes the attribute and appends a second selector
      "a']",
      'a\\',
      'a b',
      'a>b',
      'a:hover',
      '*',
      '',
      '-leading',
      'trailing-',
      'double--hyphen',
      'UPPER',
      'a'.repeat(129),
    ];
    for (const handle of hostile) {
      expect(isValidElementHandle(handle)).toBe(false);
      expect(() => resolveHandleSelector(handle)).toThrow(/invalid element handle/);
    }
  });
});

describe('findFieldFillRefusal', () => {
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

import { describe, expect, it } from 'vitest';

import {
  CHAT_CAPABILITIES,
  PAGE_CAPABILITIES,
  availableCapabilities,
  findCapability,
  findCapabilityInputError,
  type CapabilityDef,
} from '../../agentic/index.js';

const ALL: readonly CapabilityDef[] = [...CHAT_CAPABILITIES, ...PAGE_CAPABILITIES];

// Placed here (capability.ts) rather than split across chat-capabilities.test.ts /
// page-capabilities.test.ts: every it() below validates the generic CapabilityDef shape
// contract over the combined manifest, not a function specific to either data module.
// chat-capabilities.ts and page-capabilities.ts have no dedicated test file as a result —
// see the reorg report's "modules with no test file" list.
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

describe('findCapabilityInputError', () => {
  const schema = {
    type: 'object' as const,
    properties: {
      element: { type: 'string' },
      count: { type: 'number' },
      confirm: { type: 'boolean' },
      role: { type: 'string', enum: ['button', 'field'] as const },
      tags: { type: 'array' },
    },
    required: ['element'],
    additionalProperties: false as const,
  };
  const capability: CapabilityDef = {
    id: 'test.capability',
    description: 'A capability used to exercise input validation.',
    inputSchema: schema,
    risk: 'read',
    surface: 'session',
  };

  it('accepts input that satisfies the schema', () => {
    expect(findCapabilityInputError(capability, { element: 'a' })).toBeNull();
    expect(findCapabilityInputError(capability, { element: 'a', count: 1, confirm: true })).toBeNull();
  });

  it('reports a missing required field', () => {
    expect(findCapabilityInputError(capability, {})).toBe('"element" is required');
    // Explicitly-undefined is the same as absent, not a supplied value.
    expect(findCapabilityInputError(capability, { element: undefined })).toBe('"element" is required');
  });

  it('reports unknown fields, singular and plural, sorted', () => {
    expect(findCapabilityInputError(capability, { element: 'a', nope: 1 }))
      .toBe('unknown argument: nope');
    expect(findCapabilityInputError(capability, { element: 'a', zeta: 1, alpha: 2 }))
      .toBe('unknown arguments: alpha, zeta');
  });

  it('allows unknown fields when the schema does not close the shape', () => {
    const open: CapabilityDef = {
      ...capability,
      inputSchema: { ...schema, additionalProperties: true },
    };
    expect(findCapabilityInputError(open, { element: 'a', extra: 1 })).toBeNull();
  });

  it('reports a type mismatch, naming what arrived', () => {
    expect(findCapabilityInputError(capability, { element: 1 }))
      .toBe('"element" must be a string, received number');
    expect(findCapabilityInputError(capability, { element: 'a', count: 'two' }))
      .toBe('"count" must be a number, received string');
    expect(findCapabilityInputError(capability, { element: 'a', confirm: 'yes' }))
      .toBe('"confirm" must be a boolean, received string');
  });

  it('distinguishes an array from a plain object', () => {
    // typeof [] is "object", so an unguarded check would let an array through as an object and
    // vice versa.
    expect(findCapabilityInputError(capability, { element: 'a', tags: ['x'] })).toBeNull();
    expect(findCapabilityInputError(capability, { element: 'a', tags: { x: 1 } }))
      .toBe('"tags" must be a array, received object');
  });

  it('enforces a declared enum', () => {
    expect(findCapabilityInputError(capability, { element: 'a', role: 'button' })).toBeNull();
    expect(findCapabilityInputError(capability, { element: 'a', role: 'admin' }))
      .toBe('"role" must be one of: button, field');
  });

  it('skips optional fields that were not supplied', () => {
    expect(findCapabilityInputError(capability, { element: 'a', count: undefined })).toBeNull();
  });

  it('reports the missing field before complaining about anything else', () => {
    // Ordering matters for the message a caller sees: "you forgot X" is more useful than a
    // type complaint about an unrelated field.
    expect(findCapabilityInputError(capability, { count: 'two' })).toBe('"element" is required');
  });

  it('accepts every shipped capability with valid input', () => {
    expect(findCapabilityInputError(findCapability(ALL, 'chat.get_state')!, {})).toBeNull();
    expect(findCapabilityInputError(findCapability(ALL, 'chat.send_message')!, { prompt: 'hi' })).toBeNull();
    expect(findCapabilityInputError(findCapability(ALL, 'page.click')!, { element: 'add-task-button' })).toBeNull();
  });
});

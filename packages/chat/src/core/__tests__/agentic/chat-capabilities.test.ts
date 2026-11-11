import { describe, expect, it } from 'vitest';

import { PAGE_CAPABILITIES, findCapability, findCapabilityInputError, type CapabilityDef } from '@jini-ai/agentic';

import { CHAT_CAPABILITIES } from '../../agentic/chat-capabilities.js';

/**
 * The real combined manifest a host actually builds (see `examples/reference-web/src/daemon.ts`:
 * `[...PAGE_CAPABILITIES, ...CHAT_CAPABILITIES]`). `@jini-ai/agentic`'s own capability.test.ts
 * exercises the same generic invariants against a synthetic fixture, because that package must
 * not depend on chat-core (see its module doc); this file is the real-data regression check that
 * the generic behavior still holds once the two real manifests are combined — new 2026-07-26,
 * relocated from what was `packages/chat-core/src/__tests__/agentic/capability.test.ts` before
 * the `@jini-ai/agentic` extraction split page-capabilities.ts out from under it. chat-capabilities.ts
 * previously had no dedicated test file (only exercised indirectly via that combined-manifest
 * file) — it has one now, scoped to exactly the assertions that need its real data.
 */
const ALL: readonly CapabilityDef[] = [...CHAT_CAPABILITIES, ...PAGE_CAPABILITIES];

describe('chat-capabilities × page-capabilities: the real combined manifest', () => {
  it('gates the one destructive capability behind explicit confirmation', () => {
    const confirming = ALL.filter((capability) => capability.requiresConfirmation === true);
    expect(confirming.map((capability) => capability.id)).toEqual(['chat.reset_conversation']);
    for (const capability of confirming) {
      expect(capability.inputSchema.required).toContain('confirm');
      expect(capability.inputSchema.properties['confirm']?.type).toBe('boolean');
    }
  });

  it('hides session-only capabilities when no frontend is connected, leaving only chat.send_message', () => {
    const withoutSession = ALL.filter((capability) => capability.surface === 'server');
    expect(withoutSession.map((capability) => capability.id)).toEqual(['chat.send_message']);
    // No page verb is reachable without a live session.
    expect(ALL.some((capability) => capability.surface === 'server' && capability.id.startsWith('page.'))).toBe(
      false,
    );
  });

  it('accepts the real shipped chat capabilities with valid input', () => {
    expect(findCapabilityInputError({ capability: findCapability({ capabilities: ALL, id: 'chat.get_state' })!, input: {} })).toBeNull();
    expect(findCapabilityInputError({ capability: findCapability({ capabilities: ALL, id: 'chat.send_message' })!, input: { prompt: 'hi' } })).toBeNull();
  });
});

// Stryker L5 (2026-10-25): 27 of 40 mutants survived — no test compared the manifest to an
// expected literal. Inline, exact (descriptions only checked as strings): the schema is the
// contract a model sees, risk/surface/requiresConfirmation drive approval and routing.
describe('CHAT_CAPABILITIES contract (F3)', () => {
  const text = expect.any(String);
  const str = { type: 'string', description: text };
  const empty = { type: 'object', properties: {}, additionalProperties: false };

  it('matches the expected manifest exactly', () => {
    expect(CHAT_CAPABILITIES).toEqual([
      { id: 'chat.send_message', description: text, risk: 'write', surface: 'server',
        inputSchema: { type: 'object', properties: { prompt: str }, required: ['prompt'], additionalProperties: false } },
      { id: 'chat.set_draft', description: text, risk: 'write', surface: 'session',
        inputSchema: { type: 'object', properties: { text: str }, required: ['text'], additionalProperties: false } },
      { id: 'chat.select_agent', description: text, risk: 'write', surface: 'session',
        inputSchema: { type: 'object', properties: { agentId: str, model: str, reasoning: str }, required: ['agentId'], additionalProperties: false } },
      { id: 'chat.cancel_run', description: text, risk: 'write', surface: 'session', inputSchema: empty },
      { id: 'chat.reset_conversation', description: expect.stringContaining('DESTRUCTIVE'), risk: 'write', surface: 'session', requiresConfirmation: true,
        inputSchema: { type: 'object', properties: { confirm: { type: 'boolean', description: text } }, required: ['confirm'], additionalProperties: false } },
      { id: 'chat.set_working_directory', description: expect.stringContaining('recentDirectories'), risk: 'write', surface: 'session',
        inputSchema: { type: 'object', properties: { path: str }, required: ['path'], additionalProperties: false } },
      { id: 'chat.get_state', description: text, risk: 'read', surface: 'session', inputSchema: empty },
    ]);
  });

  it('only reset_conversation requires confirmation, and only get_state is read-only', () => {
    expect(CHAT_CAPABILITIES.filter((c) => c.requiresConfirmation).map((c) => c.id)).toEqual(['chat.reset_conversation']);
    expect(CHAT_CAPABILITIES.filter((c) => c.risk === 'read').map((c) => c.id)).toEqual(['chat.get_state']);
  });
});

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
    expect(findCapabilityInputError(findCapability(ALL, 'chat.get_state')!, {})).toBeNull();
    expect(findCapabilityInputError(findCapability(ALL, 'chat.send_message')!, { prompt: 'hi' })).toBeNull();
  });
});

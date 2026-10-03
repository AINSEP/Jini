import { expect, it } from 'vitest';
import { sqliteFixture } from '../store/__tests__/fixtures.js';
import { runContentFromEvents, runEventsForSave } from '../core/run-events/entry.js';
import type { AgentEvent } from '../core/events.js';

// The event extraction must still persist through the final DB-lane projection. Testing against
// the real adapter protects both event order and the deliberately narrow set of durable fields.
it('round-trips extracted run output through the borrowed, owner-scoped SQLite adapter', async () => {
  const fixture = await sqliteFixture();
  try {
    const scope = { scopeId: 'workspace', ownerKind: 'user', ownerId: 'alice' } as const;
    const store = fixture.make(scope, { nowMs: () => 42 });
    await store.create({ id: 'conversation' });
    const events: AgentEvent[] = [
      { kind: 'text', text: 'Hello ' }, { kind: 'text', text: 'world' },
      { kind: 'tool_use', id: 'tool', name: 'search', input: {} },
      { kind: 'tool_result', toolUseId: 'tool', content: 'result', isError: false },
      { kind: 'text', text: 'Answer' },
    ];
    const persisted = {
      id: 'answer', role: 'assistant' as const,
      content: runContentFromEvents({ events }), events: runEventsForSave({ events }),
      runId: 'run', runStatus: 'succeeded' as const, endedAt: 99,
    };
    expect(await store.appendMessage({ conversationId: 'conversation', message: persisted })).toEqual({ ...persisted, createdAt: 42 });
    expect(await store.messages({ conversationId: 'conversation' })).toEqual([{ ...persisted, createdAt: 42 }]);
    expect(await fixture.make({ ...scope, ownerId: 'bob' }).messages({ conversationId: 'conversation' })).toEqual([]);
    expect(await fixture.make({ ...scope, ownerId: 'bob' }).appendMessage({ conversationId: 'conversation', message: persisted })).toBeNull();
  } finally {
    await fixture.close();
  }
});

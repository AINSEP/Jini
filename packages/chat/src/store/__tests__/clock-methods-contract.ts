/** Real-driver object-method and shared-clock behavior; all SQL dialects use this contract. */
import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '@jini-ai/core/primitives';
import type { Fixture } from './fixtures.js';

/** Exercises owner isolation, optional paging/title/expiry arguments and clock receiver binding. */
export function chatClockMethodsContract({ name, fixture }: { name: string; fixture: () => Promise<Fixture> }): void {
  describe(`${name} clock and object methods`, () => {
    // REGRESSION: fails if the SQL factory reads optional.now instead of optional.clock.nowMs().
    it('persists a shared core clock and preserves its receiver across create, append, rename and touch', async () => {
      const f = await fixture();
      const clock: Clock & { time: number } = { time: 4102444800123, nowMs() { return this.time; } };
      const scope = { scopeId: 'clock-contract', ownerKind: 'user', ownerId: 'owner' } satisfies import('../ports.js').ChatOwnerScope;
      const owner = f.make(scope, clock);
      const other = f.make({ ...scope, ownerId: 'other' }, clock);
      try {
        expect(await owner.create({ id: 'conversation', expiresAt: clock.time + 100 })).toMatchObject({ createdAt: clock.time, updatedAt: clock.time });
        clock.time += 1;
        expect(await owner.appendMessage({ conversationId: 'conversation', message: { id: 'message', role: 'user', content: 'private' } })).toMatchObject({ createdAt: clock.time });
        expect(await other.get({ id: 'conversation' })).toBeNull();
        expect(await other.messages({ conversationId: 'conversation' })).toEqual([]);
        expect(await other.appendMessage({ conversationId: 'conversation', message: { id: 'foreign', role: 'user', content: 'injected' } })).toBeNull();
        clock.time += 1;
        expect(await owner.rename({ id: 'conversation', title: 'Manual' })).toMatchObject({ title: 'Manual', updatedAt: clock.time });
        expect(await owner.rename({ id: 'conversation', title: 'Generated' }, { source: 'generated' })).toMatchObject({ title: 'Manual' });
        clock.time += 1;
        await owner.touch({ id: 'conversation' }, { expiresAt: clock.time + 10 });
        expect(await owner.get({ id: 'conversation' })).toMatchObject({ updatedAt: clock.time, expiresAt: clock.time + 10 });
        await other.delete({ id: 'conversation' });
        expect(await owner.messages({ conversationId: 'conversation' })).toHaveLength(1);
        expect(await f.maintenance.sweepExpired({ now: clock.time + 9 }, { limit: 1 })).toBe(0);
        expect(await f.maintenance.sweepExpired({ now: clock.time + 10 }, { limit: 1 })).toBe(1);
        expect(await owner.get({ id: 'conversation' })).toBeNull();
      } finally { await f.close(); }
    });
    // REGRESSION: fails if pageConversations treats its required object as the paging options.
    it('applies the second paging bag and binds continuation to the owner', async () => {
      const f = await fixture();
      const scope = { scopeId: 'paging-contract', ownerKind: 'user', ownerId: 'owner' } satisfies import('../ports.js').ChatOwnerScope;
      const owner = f.make(scope, { nowMs: () => 42 });
      try {
        for (const id of ['c', 'a', 'b']) await owner.create({ id });
        const first = await owner.pageConversations({}, { limit: 1 });
        expect(first.items.map((item: { id: string }) => item.id)).toEqual(['a']);
        expect(first.nextCursor).toBeDefined();
        assert.ok(first.nextCursor);
        const second = await owner.pageConversations({}, { limit: 1, cursor: first.nextCursor });
        expect(second.items.map((item: { id: string }) => item.id)).toEqual(['b']);
        await expect(f.make({ ...scope, ownerId: 'other' }).pageConversations({}, { cursor: first.nextCursor })).rejects.toMatchObject({ code: 'invalid-cursor' });
      } finally { await f.close(); }
    });
    // PARITY
    it('uses system wall time when no clock is supplied', async () => {
      const f = await fixture();
      const now = vi.spyOn(Date, 'now').mockReturnValue(4102444800123);
      try {
        const owner = f.make({ scopeId: 'default-clock', ownerKind: 'user', ownerId: 'owner' });
        expect(await owner.create({ id: 'default' })).toMatchObject({ createdAt: 4102444800123, updatedAt: 4102444800123 });
      } finally { now.mockRestore(); await f.close(); }
    });
  });
}

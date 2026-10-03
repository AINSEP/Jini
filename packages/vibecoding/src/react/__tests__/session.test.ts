import { describe, expect, test, vi } from 'vitest';

import { createVibecodingSession } from '../session.js';
import type { EditTarget } from '../../core/target.js';
import type { PartId, Snapshot, ValidationResult } from '../../core/types.js';

/** The same minimal in-memory host `../../core/__tests__/apply.test.ts` and `history.test.ts`
 *  use, restated here rather than imported so this suite does not reach across `__tests__`
 *  directories for shared fixtures. */
function makeTarget(options?: {
  readonly initial?: Record<PartId, string>;
  readonly validate?: (candidate: { id: PartId; content: string }) => ValidationResult;
  readonly readPartCalls?: PartId[];
}): EditTarget & { readonly parts: Map<PartId, string> } {
  const parts = new Map<PartId, string>(Object.entries(options?.initial ?? {}));
  return {
    parts,
    listParts: async () => [...parts.keys()].map((id) => ({ id })),
    readPart: async ({ id }) => {
      options?.readPartCalls?.push(id);
      const found = parts.get(id);
      if (found === undefined) throw new Error(`no such part: ${id}`);
      return found;
    },
    replacePart: async ({ id, content }) => {
      parts.set(id, content);
    },
    snapshot: async (): Promise<Snapshot> => ({ id: 'snap', parts: Object.fromEntries(parts) }),
    restore: async ({ snapshot }) => {
      parts.clear();
      for (const [id, content] of Object.entries(snapshot.parts)) parts.set(id, content);
    },
    validate: async (candidate) => options?.validate?.(candidate) ?? { ok: true },
  };
}

describe('createVibecodingSession — refresh', () => {
  test('starts idle with no parts until refresh() resolves', async () => {
    const session = createVibecodingSession({ target: makeTarget({ initial: { a: 'A' } }) });

    expect(session.getSnapshot()).toMatchObject({ status: 'idle', parts: [] });

    await session.refresh();

    expect(session.getSnapshot().status).toBe('ready');
    expect(session.getSnapshot().parts).toEqual([{ id: 'a' }]);
  });

  test('refresh() notifies subscribers for loading and ready transitions', async () => {
    const session = createVibecodingSession({ target: makeTarget({ initial: { a: 'A' } }) });
    const listener = vi.fn();
    session.subscribe({ listener });

    await session.refresh();

    // 'loading' then 'ready' — two commits, two notifications.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('unsubscribe stops further notifications', async () => {
    const session = createVibecodingSession({ target: makeTarget() });
    const listener = vi.fn();
    const unsubscribe = session.subscribe({ listener });
    unsubscribe();

    await session.refresh();

    expect(listener).not.toHaveBeenCalled();
  });

  test('refresh() drops cached content for a part the host no longer lists', async () => {
    const target = makeTarget({ initial: { a: 'A' } });
    const session = createVibecodingSession({ target });
    await session.refresh();
    await session.readPart({ id: 'a' });
    expect(session.getSnapshot().partContent.has('a')).toBe(true);

    target.parts.delete('a');
    await session.refresh();

    expect(session.getSnapshot().partContent.has('a')).toBe(false);
  });
});

describe('createVibecodingSession — readPart caching', () => {
  test('reads through to the host once, then serves the cache', async () => {
    const readPartCalls: PartId[] = [];
    const target = makeTarget({ initial: { a: 'A' }, readPartCalls });
    const session = createVibecodingSession({ target });

    const first = await session.readPart({ id: 'a' });
    const second = await session.readPart({ id: 'a' });

    expect(first).toBe('A');
    expect(second).toBe('A');
    expect(readPartCalls).toEqual(['a']);
  });

  test('a rejected readPart sets lastError and rethrows', async () => {
    const session = createVibecodingSession({ target: makeTarget() });

    // Not `.rejects.toThrow('...')`: that overload is broken by `@testing-library/jest-dom`'s
    // global `expect.extend` under this package's jsdom projects (verified empirically — see
    // `vitest.setup.ts`'s doc). The bare, argument-less form is unaffected.
    await expect(session.readPart({ id: 'missing' })).rejects.toThrow();
    expect(session.getSnapshot().status).toBe('error');
    expect(session.getSnapshot().lastError).toContain('no such part: missing');
  });
});

describe('createVibecodingSession — applyEdits', () => {
  test('an applied edit updates the cache from the edit itself, with no SECOND readPart call', async () => {
    const readPartCalls: PartId[] = [];
    const target = makeTarget({ initial: { a: 'old' }, readPartCalls });
    const session = createVibecodingSession({ target });
    await session.refresh();

    const result = await session.applyEdits({ edits: [{ id: 'a', content: 'new' }] });

    expect(result.outcomes).toEqual([{ status: 'applied', id: 'a' }]);
    expect(result.corrections).toEqual([]);
    expect(session.getSnapshot().partContent.get('a')).toBe('new');
    // `../core/history.ts`'s own transaction wrapper reads a part once, before writing it, to
    // capture the undo entry's `before` side — that ONE call is inherent to history bookkeeping,
    // not something this session avoids. What this session's own cache update avoids is a SECOND,
    // redundant post-write read to learn content it already knows from the edit itself.
    expect(readPartCalls).toEqual(['a']);
  });

  test('a rejected edit surfaces a correction and leaves the cache untouched', async () => {
    const target = makeTarget({
      initial: { a: 'old' },
      validate: () => ({ ok: false, reason: 'unclosed <section>' }),
    });
    const session = createVibecodingSession({ target });
    await session.readPart({ id: 'a' });

    const result = await session.applyEdits({ edits: [{ id: 'a', content: 'bad' }] });

    expect(result.outcomes).toEqual([{ status: 'rejected', id: 'a', reason: 'unclosed <section>' }]);
    expect(result.corrections).toEqual([{ id: 'a', reason: 'unclosed <section>' }]);
    expect(session.getSnapshot().partContent.get('a')).toBe('old');
  });

  test('multiple edits in one call become one undoable transaction', async () => {
    const target = makeTarget({ initial: { a: 'a0', b: 'b0' } });
    const session = createVibecodingSession({ target });

    await session.applyEdits({ edits: [
      { id: 'a', content: 'a1' },
      { id: 'b', content: 'b1' },
    ] });
    expect(session.history.entries()).toHaveLength(1);
    expect(session.getSnapshot().canUndo).toBe(true);

    await session.undo();

    expect(target.parts.get('a')).toBe('a0');
    expect(target.parts.get('b')).toBe('b0');
  });
});

describe('createVibecodingSession — undo/redo cache updates', () => {
  test('undo restores the cache to the pre-edit content without a host read', async () => {
    const readPartCalls: PartId[] = [];
    const target = makeTarget({ initial: { a: 'a0' }, readPartCalls });
    const session = createVibecodingSession({ target });
    await session.applyEdits({ edits: [{ id: 'a', content: 'a1' }] });
    readPartCalls.length = 0;

    const entry = await session.undo();

    expect(entry?.changes).toEqual([{ id: 'a', before: 'a0', after: 'a1', existedBefore: true }]);
    expect(session.getSnapshot().partContent.get('a')).toBe('a0');
    expect(session.getSnapshot().canRedo).toBe(true);
    expect(readPartCalls).toEqual([]);
  });

  test('redo re-applies the cache to the post-edit content', async () => {
    const target = makeTarget({ initial: { a: 'a0' } });
    const session = createVibecodingSession({ target });
    await session.applyEdits({ edits: [{ id: 'a', content: 'a1' }] });
    await session.undo();

    const entry = await session.redo();

    expect(entry).not.toBeNull();
    expect(session.getSnapshot().partContent.get('a')).toBe('a1');
    expect(session.getSnapshot().canRedo).toBe(false);
  });

  test('undo/redo on empty stacks resolve null without touching status', async () => {
    const session = createVibecodingSession({ target: makeTarget() });

    await expect(session.undo()).resolves.toBeNull();
    await expect(session.redo()).resolves.toBeNull();
    expect(session.getSnapshot().status).toBe('ready');
  });
});

describe('createVibecodingSession — snapshot/restore', () => {
  test('restoreSnapshot is undoable and updates the cache from the snapshot', async () => {
    const target = makeTarget({ initial: { a: 'a0' } });
    const session = createVibecodingSession({ target });
    const snapshot = await session.takeSnapshot();
    await session.applyEdits({ edits: [{ id: 'a', content: 'edited' }] });

    const entry = await session.restoreSnapshot({ snapshot });

    expect(entry).not.toBeNull();
    expect(session.getSnapshot().partContent.get('a')).toBe('a0');

    await session.undo();
    expect(session.getSnapshot().partContent.get('a')).toBe('edited');
  });
});

describe('session object API and batch reconciliation', () => {
  test('history tuning and transaction labels use the optional second object', async () => {
    const target = makeTarget({ initial: { a: 'old' } });
    const session = createVibecodingSession({ target }, { historyOptions: { limit: 1 } });

    await session.applyEdits({ edits: [{ id: 'a', content: 'first' }] }, { label: 'first turn' });
    await session.applyEdits({ edits: [{ id: 'a', content: 'last' }] }, { label: 'last turn' });

    expect(session.history.entries()).toEqual([{
      label: 'last turn',
      changes: [{ id: 'a', before: 'first', after: 'last', existedBefore: true }],
    }]);
    await session.undo();
    expect(target.parts.get('a')).toBe('first');
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  test('repeated ids cache the last successful edit and preserve positional outcomes', async () => {
    const target = makeTarget({
      initial: { a: 'old' },
      validate: ({ content }) => content === 'bad' ? { ok: false, reason: 'invalid' } : { ok: true },
    });
    const session = createVibecodingSession({ target });

    const result = await session.applyEdits({ edits: [
      { id: 'a', content: 'first' },
      { id: 'a', content: 'last' },
      { id: 'a', content: 'bad' },
    ] });

    expect(result).toEqual({
      outcomes: [
        { status: 'applied', id: 'a' },
        { status: 'applied', id: 'a' },
        { status: 'rejected', id: 'a', reason: 'invalid' },
      ],
      corrections: [{ id: 'a', reason: 'invalid' }],
    });
    expect(target.parts.get('a')).toBe('last');
    expect(await session.readPart({ id: 'a' })).toBe('last');
    await session.undo();
    expect(await session.readPart({ id: 'a' })).toBe('old');
    await session.redo();
    expect(await session.readPart({ id: 'a' })).toBe('last');
  });
});

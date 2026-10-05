/**
 * Direct tests for the versioned keyset cursor (`sql/cursor.ts`). The store contracts prove a few
 * cross-scope rejections through real drivers; this file walks every structural check so a cursor
 * forged for another owner, conversation or read kind can never reach a query.
 */
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, pageLimit } from '../sql/cursor.js';
import { ChatStoreError } from '../errors.js';
import type { ChatOwnerScope } from '../ports.js';

const scope: ChatOwnerScope = { scopeId: 'site-1', ownerKind: 'user', ownerId: 'u-ü/+?' };

/** Independent encoder (Node's base64url), so expectations never come from the code under test. */
function forge(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function expectInvalid(run: () => unknown): ChatStoreError {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ChatStoreError);
  expect((caught as ChatStoreError).code).toBe('invalid-cursor');
  return caught as ChatStoreError;
}

const owner = ['site-1', 'user', 'u-ü/+?'];

describe('pageLimit', () => {
  it('defaults to 50 when no options or no limit is given', () => {
    expect(pageLimit({ options: undefined })).toBe(50);
    expect(pageLimit({ options: {} })).toBe(50);
  });

  it('accepts the inclusive bounds 1 and 200', () => {
    expect(pageLimit({ options: { limit: 1 } })).toBe(1);
    expect(pageLimit({ options: { limit: 200 } })).toBe(200);
  });

  it('rejects out-of-range and non-integer limits with invalid-input', () => {
    for (const limit of [0, 201, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let caught: unknown;
      try { pageLimit({ options: { limit } }); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ChatStoreError);
      expect((caught as ChatStoreError).code).toBe('invalid-input');
    }
  });
});

describe('encodeCursor', () => {
  it('produces the base64url of [version 1, kind, owner tuple, conversation, anchor] with no padding', () => {
    const cursor = encodeCursor({ kind: 'messages', scope, conversation: 'conv-1', anchor: [7, 'm-7'] });
    expect(cursor).toBe(forge([1, 'messages', owner, 'conv-1', [7, 'm-7']]));
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips non-ASCII ids whose bytes need the url-safe alphabet', () => {
    const anchor = [1_700_000_000_000, 'ïd/+?~'] as const;
    const cursor = encodeCursor({ kind: 'conversations', scope, conversation: null, anchor });
    expect(decodeCursor({ cursor, kind: 'conversations', scope, conversation: null })).toEqual([1_700_000_000_000, 'ïd/+?~']);
  });
});

describe('decodeCursor', () => {
  it('returns undefined when there is no cursor (first page)', () => {
    expect(decodeCursor({ cursor: undefined, kind: 'messages', scope, conversation: 'c' })).toBeUndefined();
  });

  it('returns a fresh copy of the anchor for a valid messages cursor', () => {
    const cursor = forge([1, 'messages', owner, 'c', [0, 'm']]);
    expect(decodeCursor({ cursor, kind: 'messages', scope, conversation: 'c' })).toEqual([0, 'm']);
  });

  it('rejects empty, over-long and non-base64url strings before decoding', () => {
    expectInvalid(() => decodeCursor({ cursor: '', kind: 'messages', scope, conversation: 'c' }));
    expectInvalid(() => decodeCursor({ cursor: 'A'.repeat(8193), kind: 'messages', scope, conversation: 'c' }));
    for (const bad of ['abc=', 'ab+c', 'ab/c', 'a b']) expectInvalid(() => decodeCursor({ cursor: bad, kind: 'messages', scope, conversation: 'c' }));
    expectInvalid(() => decodeCursor({ cursor: 42 as unknown as string, kind: 'messages', scope, conversation: 'c' }));
  });

  it('accepts a cursor of exactly 8192 characters as far as the length check goes', () => {
    // 8192 chars of 'A' decode to zero bytes -> JSON.parse('\0...') fails -> invalid, but via the
    // decode path with a cause, not the up-front shape check (which carries no cause).
    const error = expectInvalid(() => decodeCursor({ cursor: 'A'.repeat(8192), kind: 'messages', scope, conversation: 'c' }));
    expect(error.cause).toBeDefined();
  });

  it('wraps an undecodable body (bad base64 length, invalid UTF-8, non-JSON) with the cause attached', () => {
    const badLength = expectInvalid(() => decodeCursor({ cursor: 'A', kind: 'messages', scope, conversation: 'c' }));
    expect(badLength.cause).toBeDefined();
    const badUtf8 = expectInvalid(() => decodeCursor({ cursor: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url'), kind: 'messages', scope, conversation: 'c' }));
    expect(badUtf8.cause).toBeInstanceOf(TypeError);
    const notJson = expectInvalid(() => decodeCursor({ cursor: Buffer.from('not json').toString('base64url'), kind: 'messages', scope, conversation: 'c' }));
    expect(notJson.cause).toBeInstanceOf(SyntaxError);
  });

  it('rejects a wrong envelope: not an array, wrong length, wrong version, wrong kind, wrong conversation', () => {
    const decode = (value: unknown, conversation: string | null = 'c') => decodeCursor({ cursor: forge(value), kind: 'messages', scope, conversation });
    expectInvalid(() => decode({ v: 1 }));
    expectInvalid(() => decode([1, 'messages', owner, 'c']));
    expectInvalid(() => decode([1, 'messages', owner, 'c', [0, 'm'], 'extra']));
    expectInvalid(() => decode([2, 'messages', owner, 'c', [0, 'm']]));
    expectInvalid(() => decode([1, 'conversations', owner, 'c', [0, 'm']]));
    expectInvalid(() => decode([1, 'messages', owner, 'other', [0, 'm']]));
    expectInvalid(() => decode([1, 'messages', owner, null, [0, 'm']]));
  });

  it('rejects a cursor minted for any other owner tuple, or a malformed one', () => {
    const decode = (ownerValue: unknown) => decodeCursor({ cursor: forge([1, 'messages', ownerValue, 'c', [0, 'm']]), kind: 'messages', scope, conversation: 'c' });
    expectInvalid(() => decode('site-1/user/u'));
    expectInvalid(() => decode(['site-1', 'user']));
    expectInvalid(() => decode([...owner, 'extra']));
    expectInvalid(() => decode(['site-2', 'user', owner[2]]));
    expectInvalid(() => decode(['site-1', 'guest', owner[2]]));
    expectInvalid(() => decode(['site-1', 'user', 'someone-else']));
  });

  it('rejects a malformed anchor', () => {
    const decode = (anchor: unknown, kind: 'messages' | 'conversations' = 'messages') =>
      decodeCursor({ cursor: forge([1, kind, owner, kind === 'messages' ? 'c' : null, anchor]), kind, scope, conversation: kind === 'messages' ? 'c' : null });
    expectInvalid(() => decode('0:m'));
    expectInvalid(() => decode([0]));
    expectInvalid(() => decode([0, 'm', 'x']));
    expectInvalid(() => decode(['0', 'm']));
    expectInvalid(() => decode([0, 7]));
    // JSON.parse('1e999') is Infinity: the finite check is reachable from a forged cursor.
    const infinite = Buffer.from(`[1,"conversations",${JSON.stringify(owner)},null,[1e999,"x"]]`).toString('base64url');
    expectInvalid(() => decodeCursor({ cursor: infinite, kind: 'conversations', scope, conversation: null }));
  });

  it('requires a non-negative safe-integer anchor for messages but not for conversations', () => {
    const messages = (n: number) => decodeCursor({ cursor: forge([1, 'messages', owner, 'c', [n, 'm']]), kind: 'messages', scope, conversation: 'c' });
    expectInvalid(() => messages(1.5));
    expectInvalid(() => messages(-1));
    expectInvalid(() => messages(2 ** 53));
    expect(messages(Number.MAX_SAFE_INTEGER)).toEqual([Number.MAX_SAFE_INTEGER, 'm']);
    const conversations = (n: number) => decodeCursor({ cursor: forge([1, 'conversations', owner, null, [n, 'x']]), kind: 'conversations', scope, conversation: null });
    expect(conversations(1.5)).toEqual([1.5, 'x']);
    expect(conversations(-1)).toEqual([-1, 'x']);
  });
});

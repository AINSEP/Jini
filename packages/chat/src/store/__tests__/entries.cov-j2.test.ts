import { describe, expect, it } from 'vitest';
import * as neutral from '../index.js';
import * as contracts from '../contracts/index.js';
import * as published from '@jini-ai/chat/store';
import { ChatStoreError } from '../errors.js';

describe('neutral store entries', () => {
  it('store/index exposes only the ChatStoreError runtime value, the implementation class itself', () => {
    expect(Object.keys(neutral)).toEqual(['ChatStoreError']);
    expect(neutral.ChatStoreError).toBe(ChatStoreError);
  });

  it('store/contracts re-exports exactly the published @jini-ai/chat/store surface', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(published));
    expect(contracts.ChatStoreError).toBe(published.ChatStoreError);
  });

  it.each([
    ['store/index', neutral.ChatStoreError],
    ['store/contracts', contracts.ChatStoreError],
  ])('%s ChatStoreError carries a stable code and message and keeps the driver cause', (_entry, ErrorClass) => {
    const cause = new Error('SQLITE_BUSY: owner alice');
    const error = new ErrorClass({ code: 'unavailable' }, { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'ChatStoreError', code: 'unavailable', message: 'Chat store unavailable.' });
    expect(error.message).not.toContain('alice');
    expect(error.cause).toBe(cause);
  });
});

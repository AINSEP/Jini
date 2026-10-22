import { expect, it } from 'vitest';
import { ChatStoreError } from '../store/errors.js';
import { MessageConversationMismatchError } from '../store/legacy/sqlite/messages.js';

it.each([
  ['invalid-input', 'Invalid chat store input.'],
  ['invalid-cursor', 'Invalid chat page cursor.'],
  ['conflict', 'Chat store conflict.'],
  ['unavailable', 'Chat store unavailable.'],
] as const)('preserves the %s error and opaque public message with object arguments', (code, message) => {
  const cause = new Error('private driver detail');
  const error = new ChatStoreError({ code }, { cause });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('ChatStoreError');
  expect(error.code).toBe(code);
  expect(error.message).toBe(message);
  expect(error.cause).toBe(cause);
});

it('preserves mismatch identity fields and the historical message', () => {
  const error = new MessageConversationMismatchError({
    messageId: 'm1', actualConversationId: 'c1', requestedConversationId: 'c2',
  });
  expect(error.name).toBe('MessageConversationMismatchError');
  expect(error.messageId).toBe('m1');
  expect(error.actualConversationId).toBe('c1');
  expect(error.requestedConversationId).toBe('c2');
  expect(error.message).toBe('upsertMessage: message id "m1" belongs to a different conversation ("c1"), not "c2"');
});

import type { ChatStoreErrorCode } from './ports.js';

const MESSAGES: Record<ChatStoreErrorCode, string> = {
  'invalid-input': 'Invalid chat store input.',
  'invalid-cursor': 'Invalid chat page cursor.',
  conflict: 'Chat store conflict.',
  unavailable: 'Chat store unavailable.',
};

/** Stable public errors; messages never expose owner IDs, cursors or driver details.
 * @example new ChatStoreError({ code: 'conflict' }, { cause: originalError })
 */
export class ChatStoreError extends Error {
  override readonly name = 'ChatStoreError' as const;
  readonly code: ChatStoreErrorCode;
  constructor({ code }: { code: ChatStoreErrorCode }, options?: ErrorOptions) {
    super(MESSAGES[code], options);
    this.code = code;
  }
}

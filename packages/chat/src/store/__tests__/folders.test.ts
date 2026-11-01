import { expect, it } from 'vitest';
import { createSqliteChatStore } from '../sqlite/index.js';
import { sqliteFixture } from './fixtures.js';
import { acceptedInputsFromMessages, projectAcceptedInputMessages } from '../../core/accepted-input.js';
import type { ChatMessage } from '../../core/messages.js';

it('round-trips ordinary and queued folder receipts through storage without changing any path bytes', async () => {
  const folders = ['/tmp/A B', String.raw`C:\A B`, String.raw`\\srv\share`];
  const fixture = await sqliteFixture();
  try {
    const store = createSqliteChatStore({ kernel: fixture.kernel, scope: { scopeId: 's', ownerId: 'u', ownerKind: 'user' } });
    await store.create({ id: 'c' });
    const message: ChatMessage = { id: 'm', role: 'user', content: 'inspect', folders };
    await store.appendMessage({ conversationId: 'c', message });
    const replay = await store.messages({ conversationId: 'c' });
    expect(replay[0]?.folders).toEqual(folders);
    expect(projectAcceptedInputMessages({ messages: replay })[0]?.folders).toEqual(folders);
    expect(acceptedInputsFromMessages({ messages: replay })[0]?.folders).toEqual(folders);
  } finally { await fixture.close(); }
});

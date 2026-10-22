import type { ToolMetadataById } from '@jini-ai/core';

/** Discovery and read approval for the generic history tools, shared with host projections. */
export const assistantHistoryToolMetadata = {
  assistant_chats_list: {
    search: { keywords: 'previous earlier interrupted chat conversation history search resume continue what we were doing',
      queries: ['I had to start a new chat. Can you find what we were doing?', 'Find my previous conversation.'] },
    approval: { class: 'read', confirmation: 'direct' },
  },
  assistant_chat_read: {
    search: { keywords: 'read previous chat transcript history tail messages resume interrupted continue conversation' },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById;


/** Existing ai_* schema, owned and migrated by the host. No schema creation on construction. */
import type { Generated } from 'kysely';
export type AiChatsTable = {
  id: string;
  scope_id: string;
  owner_kind: string;
  owner_id: string;
  title: string | null;
  title_source: Generated<string>;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
};

export type AiChatMessagesTable = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  agent_id: string | null;
  agent_name: string | null;
  events_json: string | null;
  attachments_json: string | null;
  run_id: string | null;
  run_status: string | null;
  position: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
};

export type ChatDatabase = {
  ai_chats: AiChatsTable;
  ai_chat_messages: AiChatMessagesTable;
};

/** C1 compile contract: old fakes and the host's exact extra-table database shape. */
import type { Generated } from 'kysely';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatHistoryStore, ChatStore, ChatOwnerScope } from '../ports.js';
import type { ChatHistoryStore as OldStore } from '../../core/persistence/ports.js';
import { createSqliteChatStore, createSqliteChatMaintenance } from '../sqlite/index.js';
import { createPgliteChatStore, createPgliteChatMaintenance } from '../pglite/index.js';
import { createPostgresChatStore, createPostgresChatMaintenance } from '../postgres/index.js';
type AiChatsTable={id:string;scope_id:string;owner_kind:string;owner_id:string;title:string|null;title_source:Generated<string>;created_at:number;updated_at:number;expires_at:number|null};
type AiChatMessagesTable={id:string;conversation_id:string;role:string;content:string;agent_id:string|null;agent_name:string|null;events_json:string|null;attachments_json:string|null;run_id:string|null;run_status:string|null;position:number;created_at:number;started_at:number|null;ended_at:number|null};
type ChatDatabase={
 ai_chats:AiChatsTable;ai_chat_messages:AiChatMessagesTable;
 assistant_agent_sessions:{conversation_id:string;agent_id:string;session_id:string;updated_at:number};
 assistant_conversation_tool_approvals:{conversation_id:string;principal_id:string;connection_id:string;tool_name:string;fingerprint:string;granted_at:string};
};
export function compileContract({ kernel, scope, store }: { kernel: StorageKernel<ChatDatabase>; scope: ChatOwnerScope; store: ChatStore }){
 const fake:ChatHistoryStore={list:async()=>[],get:async()=>null,create:async input=>({id:input.id,title:null,titleSource:'fallback',messageCount:0,createdAt:0,updatedAt:0}),rename:async()=>null,touch:async()=>{},delete:async()=>{},messages:async()=>[],appendMessage:async()=>null};
 const old:OldStore=fake;const subset:OldStore=store;
 const stores:ChatStore[]=[createSqliteChatStore({kernel,scope}),createPgliteChatStore({kernel,scope}),createPostgresChatStore({kernel,scope})];
 const maintenance=[createSqliteChatMaintenance({kernel}),createPgliteChatMaintenance({kernel}),createPostgresChatMaintenance({kernel})];
 void [old,subset,stores,maintenance];
}
export function missingRequiredTable({ kernel, scope }: { kernel: StorageKernel<{ai_chats:AiChatsTable}>; scope: ChatOwnerScope }){
 // @ts-expect-error messages table is mandatory, extra tables alone cannot qualify a kernel
 createSqliteChatStore({kernel,scope});
}

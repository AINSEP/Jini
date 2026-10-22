/** Real-driver fixtures. Only test hooks touch SQL; no fake certifies a store. */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatHistoryStore, createChatHistoryMaintenance } from '../sqlite/index.js';
import { ensureChatHistoryTables } from '../sqlite/index.js';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import type { Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatDatabase } from '../sql/tables.js';
import type { ChatOwnerScope, ChatStore } from '../ports.js';
export type FixtureDatabase = ChatDatabase & {
 assistant_agent_sessions: { conversation_id: string; agent_id: string; session_id: string; updated_at: number };
 assistant_conversation_tool_approvals: { conversation_id: string; principal_id: string; connection_id: string; tool_name: string; fingerprint: string; granted_at: string };
 guard: { id: string; settled: number | null };
};
const require = createRequire(new URL('../../../../db/package.json', import.meta.url));
const Database = require('better-sqlite3');
export interface Fixture {
 make(scope: ChatOwnerScope, clock?: Clock): ChatStore;
 maintenance: ReturnType<typeof createChatHistoryMaintenance>;
 kernel: StorageKernel<FixtureDatabase>;
 messageCount(): Promise<number>;
 readCount(): number;
 readRows(): number;
 resetReadRows(): void;
 deleteMessage(id:string): Promise<void>;
 close(): Promise<void>;
}
export const HOST_DDL = `
CREATE TABLE assistant_agent_sessions (conversation_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE assistant_conversation_tool_approvals (conversation_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE, principal_id TEXT NOT NULL, connection_id TEXT NOT NULL, tool_name TEXT NOT NULL, fingerprint TEXT NOT NULL, granted_at TEXT NOT NULL);
CREATE TABLE guard (id TEXT PRIMARY KEY, settled INTEGER NOT NULL);`;
export async function sqliteFixture(): Promise<Fixture> {
 const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); ensureChatHistoryTables({ db: db }); db.exec(HOST_DDL);
 const kernel=sqliteKernel<FixtureDatabase>(db);
 let reads=0, rows=0;
 const prepare=db.prepare.bind(db);
 db.prepare=(text:string)=>{
  const st=prepare(text); const all=st.all.bind(st), get=st.get.bind(st);
  st.all=(...args:unknown[])=>{ const result=all(...args); reads++; rows+=result.length; return result; };
  st.get=(...args:unknown[])=>{ const result=get(...args); reads++; rows+=result ? 1 : 0; return result; };
  return st;
 };
 return { kernel, make: (scope, clock) => createChatHistoryStore({ db: db, scope: scope }, { ...(clock ? { clock } : {}) }),
 maintenance: createChatHistoryMaintenance({ db: db }),
 messageCount: async () => db.prepare('SELECT COUNT(*) AS n FROM ai_chat_messages').get().n,
 readCount:()=>reads,readRows:()=>rows,resetReadRows:()=>{rows=0;},
 deleteMessage:async(id)=>{ db.prepare('DELETE FROM ai_chat_messages WHERE id = ?').run(id); },
 close: async () => db.close() };
}

/** Independent real SQLite connections sharing only a disposable file. */
export async function twoSqliteConnections() {
 const dir=mkdtempSync(join(tmpdir(),'chat-two-'));
 const file=join(dir,'chat.sqlite');
 const dbs=[new Database(file),new Database(file)];
 for(const db of dbs){db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');}
 ensureChatHistoryTables({ db: dbs[0] });dbs[0].exec(HOST_DDL);
 const wrap=(db:any):Fixture=>({kernel:sqliteKernel<FixtureDatabase>(db),make:(scope,clock)=>createChatHistoryStore({ db: db, scope: scope }, { ...(clock ? { clock } : {}) }),maintenance:createChatHistoryMaintenance({ db: db }),messageCount:async()=>db.prepare('SELECT COUNT(*) n FROM ai_chat_messages').get().n,readCount:()=>0,readRows:()=>0,resetReadRows:()=>{},deleteMessage:async id=>{db.prepare('DELETE FROM ai_chat_messages WHERE id=?').run(id);},close:async()=>{}});
 return {a:wrap(dbs[0]),b:wrap(dbs[1]),close:async()=>{for(const db of dbs)db.close();rmSync(dir,{recursive:true,force:true});}};
}

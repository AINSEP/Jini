/** Real-driver fixtures. Only test hooks touch SQL; no fake certifies a store. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFileSqliteTestKernel, openMemorySqliteTestKernel, type SqliteTestKernel } from '@jini-ai/db/testing/sqlite';
import { createSqliteChatStore, createSqliteChatMaintenance, ensureChatHistoryTables } from '../sqlite/index.js';
import type { Clock } from '@jini-ai/core/primitives';
import type { ChatDatabase } from '../sql/tables.js';
import type { ChatOwnerScope, ChatStore } from '../ports.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };
export type FixtureDatabase = ChatDatabase & {
 assistant_agent_sessions: { conversation_id: string; agent_id: string; session_id: string; updated_at: number };
 assistant_conversation_tool_approvals: { conversation_id: string; principal_id: string; connection_id: string; tool_name: string; fingerprint: string; granted_at: string };
 guard: { id: string; settled: number | null };
};
/** The kernel type the fixtures hand to stores; derived so the tests name no db production type. */
export type FixtureKernel = SqliteTestKernel<FixtureDatabase>['kernel'];
export interface Fixture {
 make(scope: ChatOwnerScope, clock?: Clock): ChatStore;
 maintenance: ReturnType<typeof createSqliteChatMaintenance>;
 kernel: FixtureKernel;
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
 const { kernel, connection: db, close } = openMemorySqliteTestKernel<FixtureDatabase>();
 ensureChatHistoryTables({ db }); db.exec(HOST_DDL);
 let reads=0, rows=0;
 const prepare=db.prepare.bind(db);
 Object.assign(db,{prepare:(text:string)=>{
  const st=prepare(text); const all=st.all.bind(st), get=st.get.bind(st);
  st.all=(...args:unknown[])=>{ const result=all(...args); reads++; rows+=result.length; return result; };
  st.get=(...args:unknown[])=>{ const result=get(...args); reads++; rows+=result ? 1 : 0; return result; };
  return st;
 }});
 return { kernel, make: (scope, clock) => createSqliteChatStore({ kernel, scope, clock: clock ?? testClock }),
 maintenance: createSqliteChatMaintenance({ kernel }),
 messageCount: async () => (db.prepare('SELECT COUNT(*) AS n FROM ai_chat_messages').get() as { n: number }).n,
 readCount:()=>reads,readRows:()=>rows,resetReadRows:()=>{rows=0;},
 deleteMessage:async(id)=>{ db.prepare('DELETE FROM ai_chat_messages WHERE id = ?').run(id); },
 close };
}

/** Independent real SQLite connections sharing only a disposable file. */
export async function twoSqliteConnections() {
 const dir=mkdtempSync(join(tmpdir(),'chat-two-'));
 const path=join(dir,'chat.sqlite');
 const opened=[openFileSqliteTestKernel<FixtureDatabase>({ path }),openFileSqliteTestKernel<FixtureDatabase>({ path })];
 ensureChatHistoryTables({ db: opened[0]!.connection });opened[0]!.connection.exec(HOST_DDL);
 const wrap=({ kernel, connection: db }:SqliteTestKernel<FixtureDatabase>):Fixture=>({kernel,make:(scope,clock)=>createSqliteChatStore({ kernel, scope, clock: clock ?? testClock }),maintenance:createSqliteChatMaintenance({ kernel }),messageCount:async()=>(db.prepare('SELECT COUNT(*) n FROM ai_chat_messages').get() as {n:number}).n,readCount:()=>0,readRows:()=>0,resetReadRows:()=>{},deleteMessage:async id=>{db.prepare('DELETE FROM ai_chat_messages WHERE id=?').run(id);},close:async()=>{}});
 return {a:wrap(opened[0]!),b:wrap(opened[1]!),close:async()=>{for(const each of opened)await each.close();rmSync(dir,{recursive:true,force:true});}};
}

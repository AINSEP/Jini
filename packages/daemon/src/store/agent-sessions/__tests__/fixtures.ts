/** Fresh disposable real databases; production never creates the session table. */
import Database from 'better-sqlite3';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'kysely';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import type { StorageKernel } from '@jini-ai/db/kernel';
import { createSqliteAgentSessionStore } from '../sqlite.js';
import { createPgliteAgentSessionStore } from '../pglite.js';
import type { AgentSessionDatabase } from '../sql.js';
export const DDL = `CREATE TABLE ai_chats(id TEXT PRIMARY KEY);
CREATE TABLE assistant_agent_sessions(conversation_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,agent_id TEXT NOT NULL,session_id TEXT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(conversation_id,agent_id));
INSERT INTO ai_chats VALUES ('a:b'),('a');`;
export async function schema(kernel:StorageKernel<AgentSessionDatabase>){for(const statement of DDL.split(';').filter(s=>s.trim()))await kernel.execute(sql.raw(statement));}
export async function sqliteFixture(){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(DDL);
 const kernel=sqliteKernel<AgentSessionDatabase>(db);
 return {kernel,store:createSqliteAgentSessionStore({kernel}),close:async()=>{db.close();}};
}
export async function pgliteFixture(){
 const kernel=openPgliteKernel<AgentSessionDatabase>({PGlite});
 try{await schema(kernel);return {kernel,store:createPgliteAgentSessionStore({kernel}),close:()=>kernel.close()};}
 catch(error){await kernel.close();throw error;}
}

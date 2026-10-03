/** C2 concurrent session upserts on two real SQLite connections to one disposable file. */
import Database from 'better-sqlite3';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sql } from 'kysely';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { expect,it } from 'vitest';
import { createSqliteAgentSessionStore } from '../sqlite.js';
import type { AgentSessionDatabase } from '../sql.js';
import { DDL } from './fixtures.js';
it('concurrent setters share one durable primary-key mapping and survive reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'c2-session-two-')),file=join(dir,'sessions.sqlite');
 const dbs=[new Database(file),new Database(file)];
 try {
  for(const db of dbs){db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');}
  dbs[0]!.exec(DDL);
  const kernels=dbs.map(db=>sqliteKernel<AgentSessionDatabase>(db));
  const stores=kernels.map(kernel=>createSqliteAgentSessionStore({kernel}));
  await Promise.all([stores[0]!.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'one' }),stores[1]!.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'two' })]);
  const saved=await stores[0]!.getSessionId({ conversationId: 'a:b', agentId: 'c' });expect(['one','two']).toContain(saved);
  const rows=await kernels[1]!.query<{n:number}>(sql`SELECT COUNT(*) AS n FROM assistant_agent_sessions`);expect(rows).toEqual([{n:1}]);
  dbs.forEach(db=>db.close());
  const reopened=new Database(file);try{
   const store=createSqliteAgentSessionStore({kernel:sqliteKernel<AgentSessionDatabase>(reopened)});
   expect(await store.getSessionId({ conversationId: 'a:b', agentId: 'c' })).toBe(saved);
  }finally{reopened.close();}
 }finally{dbs.forEach(db=>{if(db.open)db.close();});rmSync(dir,{recursive:true,force:true});}
});

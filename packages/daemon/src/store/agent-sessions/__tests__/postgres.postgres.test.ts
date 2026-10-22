/** C2 requires real Postgres; an unavailable disposable database is a failure, never a skip. */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { expect,it } from 'vitest';
import { openPostgresKernel } from '@jini-ai/db/kernel/postgres';
import { scopeToSchema } from '@jini-ai/db/kernel';
import { createPostgresAgentSessionStore } from '../postgres.js';
import type { AgentSessionDatabase } from '../sql.js';
import { schema } from './fixtures.js';
import { sqlSessionContract } from './sql-contract.js';
function url():string {
 const value=process.env.JINI_DAEMON_TEST_POSTGRES_URL;
 if(!value || !/^jini_daemon_test_/.test(new URL(value).pathname.slice(1)))throw new Error('Set JINI_DAEMON_TEST_POSTGRES_URL to a disposable jini_daemon_test_* database.');
 return value;
}
async function pair(){
 const a=openPostgresKernel<AgentSessionDatabase>({pg,connectionString:url()}),b=openPostgresKernel<AgentSessionDatabase>({pg,connectionString:url()});
 const name='session_test_'+randomUUID().replaceAll('-','');
 try {
  await a.execute(sql`CREATE SCHEMA ${sql.id(name)}`);
  const ka=scopeToSchema(a,name),kb=scopeToSchema(b,name);await schema(ka);
  return {a:ka,b:kb,close:async()=>{try{await a.execute(sql`DROP SCHEMA ${sql.id(name)} CASCADE`);}finally{await Promise.all([a.close(),b.close()]);}}};
 }catch(error){await Promise.all([a.close(),b.close()]);throw error;}
}
sqlSessionContract(async()=>{const f=await pair();return {kernel:f.a,store:createPostgresAgentSessionStore({kernel:f.a}),close:f.close};},createPostgresAgentSessionStore);
it('two independent connections concurrently set the same pair without duplicate rows',async()=>{
 const f=await pair();try {
  const a=createPostgresAgentSessionStore({kernel:f.a}),b=createPostgresAgentSessionStore({kernel:f.b});
  await Promise.all([a.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'one' }),b.setSessionId({ conversationId: 'a:b', agentId: 'c', sessionId: 'two' })]);
  expect(['one','two']).toContain(await a.getSessionId({ conversationId: 'a:b', agentId: 'c' }));
  const rows=await f.a.query<{n:string}>(sql`SELECT COUNT(*) AS n FROM assistant_agent_sessions`);expect(Number(rows[0]?.n)).toBe(1);
 }finally{await f.close();}
});

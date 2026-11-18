/** Every backend gets a fresh disposable schema and host-owned extra tables. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { type KyselyPlugin, type RootOperationNode } from 'kysely';
import { openPgliteTestKernel } from '@jini-ai/db/testing/pglite';
import { startPgliteTestOwner } from '@jini-ai/db/testing/pglite-owner';
import { openPgliteSocketTestKernel, openPostgresTestKernel } from '@jini-ai/db/testing/postgres';
import { createPgliteChatStore, createPgliteChatMaintenance } from '../pglite/index.js';
import { createPostgresChatStore, createPostgresChatMaintenance } from '../postgres/index.js';
import { HOST_DDL, type Fixture, type FixtureDatabase, type FixtureKernel } from './fixtures.js';
// This fixture DDL has no procedural bodies or quoted semicolons. PGlite's query path
// prepares one statement; applying statements separately also works with both PG transports.
const DDL=(readFileSync(new URL('./pg-schema.sql',import.meta.url),'utf8')+HOST_DDL).split(';').map(text=>text.trim()).filter(Boolean);
function fixture(kernel:FixtureKernel,create:typeof createPgliteChatStore,maintenance:typeof createPgliteChatMaintenance,close:()=>Promise<void>):Fixture{
 let reads=0,rows=0;const selects=new Set<object>();
 const plugin:KyselyPlugin={
  transformQuery(args){if(args.node.kind==='SelectQueryNode')selects.add(args.queryId);return args.node as RootOperationNode;},
  async transformResult(args){if(selects.delete(args.queryId)){reads++;rows+=args.result.rows.length;}return args.result;},
 };
 const run=kernel.run.bind(kernel);kernel.run=fn=>run(db=>fn(db.withPlugin(plugin)));
 return {kernel,make:(scope,clock)=>create({kernel,scope,clock:clock??{nowMs:()=>Date.now()}}),maintenance:maintenance({kernel}),
 messageCount:async()=>Number((await kernel.run(db=>db.selectFrom('ai_chat_messages').select(eb=>eb.fn.countAll().as('n')).executeTakeFirstOrThrow())).n),
 readCount:()=>reads,readRows:()=>rows,resetReadRows:()=>{rows=0;},
 deleteMessage:async id=>{await kernel.run(db=>db.deleteFrom('ai_chat_messages').where('id','=',id).execute());},close};
}
export async function pgliteFixture():Promise<Fixture>{
 const {kernel,close}=await openPgliteTestKernel<FixtureDatabase>({},{ddl:DDL});
 return fixture(kernel,createPgliteChatStore,createPgliteChatMaintenance,close);
}
function postgresUrl():string{
 const url=process.env.JINI_CHAT_TEST_POSTGRES_URL;
 if(!url)throw new Error('Set JINI_CHAT_TEST_POSTGRES_URL to a disposable jini_chat_test_* database; Postgres tests never skip.');
 if(!/^jini_chat_test_/.test(new URL(url).pathname.slice(1)))throw new Error('Postgres fixture requires a disposable jini_chat_test_* database.');
 return url;
}
async function pgPair(){
 const url=postgresUrl();const schema=`chat_test_${randomUUID().replaceAll('-','')}`;
 // The first kernel creates the schema and the tables and drops the schema on close; the second joins it.
 const a=await openPostgresTestKernel<FixtureDatabase>({url},{schema,ddl:DDL});
 try{
  const b=await openPostgresTestKernel<FixtureDatabase>({url},{schema});
  return {a:fixture(a.kernel,createPostgresChatStore,createPostgresChatMaintenance,async()=>{}),b:fixture(b.kernel,createPostgresChatStore,createPostgresChatMaintenance,async()=>{}),
   close:async()=>{try{await a.close();}finally{await b.close();}}};
 }catch(error){await a.close();throw error;}
}
export async function twoPostgresConnections(){return pgPair();}
export async function postgresFixture():Promise<Fixture>{const pair=await pgPair();return {...pair.a,close:pair.close};}
export async function pgliteSocketFixture():Promise<Fixture>{
 const owner=await startPgliteTestOwner();
 try{
  const {kernel,close}=await openPgliteSocketTestKernel<FixtureDatabase>({socketPath:owner.socketPath},{ddl:DDL});
  return fixture(kernel,createPgliteChatStore,createPgliteChatMaintenance,async()=>{try{await close();}finally{await owner.close();}});
 }catch(error){await owner.close();throw error;}
}

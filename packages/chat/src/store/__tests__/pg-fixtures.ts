/** Every backend gets a fresh disposable schema and host-owned extra tables. */
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { sql, type KyselyPlugin, type RootOperationNode } from 'kysely';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import { openPostgresKernel, openPgliteSocketKernel } from '@jini-ai/db/kernel/postgres';
import { scopeToSchema, type StorageKernel } from '@jini-ai/db/kernel';
import { startPgliteOwner } from '@jini-ai/db/pglite';
import { createPgliteChatStore, createPgliteChatMaintenance } from '../pglite/index.js';
import { createPostgresChatStore, createPostgresChatMaintenance } from '../postgres/index.js';
import { HOST_DDL, type Fixture, type FixtureDatabase } from './fixtures.js';
const require=createRequire(new URL('../../../../db/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');const pg=require('pg');
const DDL=readFileSync(new URL('./pg-schema.sql',import.meta.url),'utf8')+HOST_DDL;
// This fixture DDL has no procedural bodies or quoted semicolons. PGlite's query path
// prepares one statement; applying statements separately also works with both PG transports.
async function applyFixtureSchema(kernel:StorageKernel<FixtureDatabase>){
 for(const statement of DDL.split(';').map(text=>text.trim()).filter(Boolean))await kernel.execute(sql.raw(statement));
}
function fixture(kernel:StorageKernel<FixtureDatabase>,create:typeof createPgliteChatStore,maintenance:typeof createPgliteChatMaintenance,close:()=>Promise<void>):Fixture{
 let reads=0,rows=0;const selects=new Set<object>();
 const plugin:KyselyPlugin={
  transformQuery(args){if(args.node.kind==='SelectQueryNode')selects.add(args.queryId);return args.node as RootOperationNode;},
  async transformResult(args){if(selects.delete(args.queryId)){reads++;rows+=args.result.rows.length;}return args.result;},
 };
 const run=kernel.run.bind(kernel);kernel.run=fn=>run(db=>fn(db.withPlugin(plugin)));
 return {kernel,make:(scope,clock)=>create({kernel,scope},{...(clock?{clock}:{})}),maintenance:maintenance({kernel}),
 messageCount:async()=>Number((await kernel.run(db=>db.selectFrom('ai_chat_messages').select(eb=>eb.fn.countAll().as('n')).executeTakeFirstOrThrow())).n),
 readCount:()=>reads,readRows:()=>rows,resetReadRows:()=>{rows=0;},
 deleteMessage:async id=>{await kernel.run(db=>db.deleteFrom('ai_chat_messages').where('id','=',id).execute());},close};
}
export async function pgliteFixture():Promise<Fixture>{
 const kernel=openPgliteKernel<FixtureDatabase>({PGlite});
 try{await applyFixtureSchema(kernel);return fixture(kernel,createPgliteChatStore,createPgliteChatMaintenance,()=>kernel.close());}
 catch(error){await kernel.close();throw error;}
}
function postgresUrl():string{
 const url=process.env.JINI_CHAT_TEST_POSTGRES_URL;
 if(!url)throw new Error('Set JINI_CHAT_TEST_POSTGRES_URL to a disposable jini_chat_test_* database; Postgres tests never skip.');
 if(!/^jini_chat_test_/.test(new URL(url).pathname.slice(1)))throw new Error('Postgres fixture requires a disposable jini_chat_test_* database.');
 return url;
}
async function pgPair(){
 const connectionString=postgresUrl();const schema=`chat_test_${randomUUID().replaceAll('-','')}`;
 const a=openPostgresKernel<FixtureDatabase>({pg,connectionString});const b=openPostgresKernel<FixtureDatabase>({pg,connectionString});
 try{
  await a.execute(sql`CREATE SCHEMA ${sql.id(schema)}`);
  await a.transaction(async()=>{await a.execute(sql`SET LOCAL search_path TO ${sql.id(schema)}`);await applyFixtureSchema(a);});
  const ka=scopeToSchema(a,schema),kb=scopeToSchema(b,schema);
  return {a:fixture(ka,createPostgresChatStore,createPostgresChatMaintenance,async()=>{}),b:fixture(kb,createPostgresChatStore,createPostgresChatMaintenance,async()=>{}),
   close:async()=>{try{await a.execute(sql`DROP SCHEMA ${sql.id(schema)} CASCADE`);}finally{await Promise.all([a.close(),b.close()]);}}};
 }catch(error){await Promise.all([a.close(),b.close()]);throw error;}
}
export async function twoPostgresConnections(){return pgPair();}
export async function postgresFixture():Promise<Fixture>{const pair=await pgPair();return {...pair.a,close:pair.close};}
export async function pgliteSocketFixture():Promise<Fixture>{
 const dir=mkdtempSync(join(tmpdir(),'chat-sock-'));
 const owner=await startPgliteOwner({PGlite,dataDir:join(dir,'data'),lockFileName:'chat-test.lock',runDirName:'chat-test'},{socketDir:join(dir,'sock')});
 const kernel=openPgliteSocketKernel<FixtureDatabase>({pg,socketPath:owner.socketPath});
 try{
  await applyFixtureSchema(kernel);
  return fixture(kernel,createPgliteChatStore,createPgliteChatMaintenance,async()=>{try{await kernel.close();await owner.close();}finally{rmSync(dir,{recursive:true,force:true});}});
 }catch(error){await kernel.close();await owner.close();rmSync(dir,{recursive:true,force:true});throw error;}
}

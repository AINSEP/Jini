/** C2 neutral session-id import/declarations have no optional peers in an actual packed consumer. */
import { rmSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { copyPackage,fixture,pack,packages,run } from './packed-fixture.js';
it('neutral packed port works with no db/Kysely/drivers/React and keeps declaration imports usable',()=>{
 const dir=fixture({prefix:'c2-daemon-neutral-'});try {
  pack({dir,name:'daemon'});
  const result=run({dir,source:`const {createInMemoryAgentSessionStore}=await import('@jini-ai/daemon/store/agent-sessions');const s=createInMemoryAgentSessionStore({});await s.setSessionId({conversationId:'a:b',agentId:'c',sessionId:'one'});await s.setSessionId({conversationId:'a',agentId:'b:c',sessionId:'two'});console.log(JSON.stringify([await s.getSessionId({conversationId:'a:b',agentId:'c'}),await s.getSessionId({conversationId:'a',agentId:'b:c'})]));`});
  expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toEqual(['one','two']);
  for(const peer of ['@jini-ai/db','kysely','better-sqlite3','pg','@electric-sql/pglite','react'])expect(run({dir,source:`await import(${JSON.stringify(peer)})`}).status).not.toBe(0);
  writeFileSync(join(dir,'consumer.ts'),`import {createInMemoryAgentSessionStore,type AgentSessionStore} from '@jini-ai/daemon/store/agent-sessions'; const store:AgentSessionStore=createInMemoryAgentSessionStore({});void store;`);
  const req=createRequire(join(packages,'daemon/package.json'));const check=spawnSync(process.execPath,[req.resolve('typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','consumer.ts'],{cwd:dir,encoding:'utf8'});
  expect(check.stdout+check.stderr).toBe('');expect(check.status).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
},60_000);

it('SQL factory declarations accept the host numeric timestamp and extra tables without a cast',()=>{
 const dir=fixture({prefix:'c2-session-host-types-'});try {
  for(const name of ['core','protocol','db','daemon'])pack({dir,name});
  copyPackage({dir,name:'kysely',source:join(packages,'db/node_modules/kysely')});
  writeFileSync(join(dir,'consumer.ts'),`import type {StorageKernel} from '@jini-ai/db/kernel';
import {createSqliteAgentSessionStore} from '@jini-ai/daemon/store/agent-sessions/sqlite';
import {createPgliteAgentSessionStore} from '@jini-ai/daemon/store/agent-sessions/pglite';
import {createPostgresAgentSessionStore} from '@jini-ai/daemon/store/agent-sessions/postgres';
type HostDatabase={assistant_agent_sessions:{conversation_id:string;agent_id:string;session_id:string;updated_at:number};ai_chats:{id:string};assistant_conversation_tool_approvals:{conversation_id:string}};
declare const kernel:StorageKernel<HostDatabase>;
void [createSqliteAgentSessionStore({kernel}),createPgliteAgentSessionStore({kernel}),createPostgresAgentSessionStore({kernel})];`);
  const req=createRequire(join(packages,'daemon/package.json'));const check=spawnSync(process.execPath,[req.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','consumer.ts'],{cwd:dir,encoding:'utf8'});
  expect(check.stdout+check.stderr).toBe('');expect(check.status).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
},60_000);

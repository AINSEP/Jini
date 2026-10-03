/** C1 packed consumers: plain Node resolution in disposable isolated installs, never bundler erasure. */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
const packageRoot=fileURLToPath(new URL('../../../',import.meta.url));
const dbRoot=join(packageRoot,'../db');
const dbRequire=createRequire(join(dbRoot,'package.json'));
const localRequire=createRequire(join(packageRoot,'package.json'));
let root:string;
const dirs:Record<string,string>={};
function copyPackage(name:string,source:string,dir:string){
 const dest=join(dir,'node_modules',name);mkdirSync(dirname(dest),{recursive:true});const root=realpathSync(source);cpSync(root,dest,{recursive:true,filter:path=>!relative(root,path).split(sep).includes('node_modules')});
}
function copyRuntimeTree(name:string,source:string,dir:string,seen=new Set<string>()){
 if(seen.has(name))return;seen.add(name);copyPackage(name,source,dir);
 const root=realpathSync(source),manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 const req=createRequire(join(root,'package.json'));
 for(const dependency of Object.keys(manifest.dependencies??{})){
  let entry=req.resolve(dependency),parent=dirname(realpathSync(entry));
  while(!existsSync(join(parent,'package.json')) || JSON.parse(readFileSync(join(parent,'package.json'),'utf8')).name!==dependency){
   const next=dirname(parent);if(next===parent)throw new Error(`Cannot locate installed package ${dependency}`);parent=next;
  }
  copyRuntimeTree(dependency,parent,dir,seen);
 }
}
function run(dir:string,source:string){return spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:dir,encoding:'utf8'});}
beforeAll(()=>{
 root=mkdtempSync(join(tmpdir(),'chat-packed-'));
 const pack=JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--cache',join(root,'npm-cache'),'--pack-destination',root],{cwd:packageRoot,encoding:'utf8'}))[0].filename;
 for(const name of ['neutral','sqlite','pglite','postgres']){
  const dir=join(root,name);dirs[name]=dir;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module'}));const dest=join(dir,'node_modules/@jini-ai/chat');mkdirSync(dest,{recursive:true});
  execFileSync('tar',['-xzf',join(root,pack),'-C',dest,'--strip-components','1']);
  copyPackage('@jini-ai/core',join(packageRoot,'../core'),dir);
  if(name!=='neutral'){
   copyPackage('@jini-ai/db',dbRoot,dir);copyPackage('kysely',join(dbRoot,'node_modules/kysely'),dir);
  }
 }
},30_000);
afterAll(()=>{if(root)rmSync(root,{recursive:true,force:true});});
it('neutral store and core work with no database, SQL or React packages installed',()=>{
 const result=run(dirs.neutral!,`const s=await import('@jini-ai/chat/store'); const c=await import('@jini-ai/chat/core'); const e=new s.ChatStoreError({ code: 'conflict' }); console.log(JSON.stringify([e.name,e.code,c.isTerminalRunStatus({ status: 'succeeded' })]));`);
 expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual(['ChatStoreError','conflict',true]);
 for(const name of ['@jini-ai/db','kysely','better-sqlite3','pg','@electric-sql/pglite','react','react-dom']){
  const missing=run(dirs.neutral!,`await import(${JSON.stringify(name)})`);expect(missing.status).not.toBe(0);expect(missing.stderr).toContain('ERR_MODULE_NOT_FOUND');
 }
});
it('neutral declarations typecheck without installing any optional peer',()=>{
 const dir=dirs.neutral!;writeFileSync(join(dir,'consumer.ts'),`import { ChatStoreError, type ChatHistoryStore, type ChatStore } from '@jini-ai/chat/store'; const error: Error = new ChatStoreError({ code: 'invalid-input' }); declare const s: ChatStore; const old: ChatHistoryStore=s; void [error,old];`);
 const result=spawnSync(process.execPath,[localRequire.resolve('typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','consumer.ts'],{cwd:dir,encoding:'utf8'});
 expect(result.stdout+result.stderr).toBe('');expect(result.status).toBe(0);
});
it.each(['sqlite','pglite','postgres'])('%s entry loads with core, db and Kysely, validates invocation, and leaves neutral usable',name=>{
 const factory=`create${name==='sqlite'?'Sqlite':name==='pglite'?'Pglite':'Postgres'}ChatStore`;
 const result=run(dirs[name]!,`const a=await import('@jini-ai/chat/store/${name}'); let code;try{a.${factory}({kernel:{dialect:'wrong',transport:'wrong'},scope:{scopeId:'s',ownerKind:'user',ownerId:'u'}});}catch(e){code=e.code;}const s=await import('@jini-ai/chat/store');const c=await import('@jini-ai/chat/core');console.log(JSON.stringify([code,new s.ChatStoreError({ code: 'unavailable' }).code,c.isTerminalRunStatus({ status: 'succeeded' })]));`);
 expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual(['invalid-input','unavailable',true]);
 const missing=run(dirs[name]!,`await import(${JSON.stringify(name==='sqlite'?'better-sqlite3':name==='pglite'?'@electric-sql/pglite':'pg')})`);
 expect(missing.status).not.toBe(0);expect(missing.stderr).toContain('ERR_MODULE_NOT_FOUND');
});
it('SQLite packed consumer needs only the injected SQLite driver, db and Kysely',()=>{
 // Copy the installed driver's declared dependency tree, not an older version's dependency list.
 const dir=dirs.sqlite!;const sqliteRoot=realpathSync(join(dbRoot,'node_modules/better-sqlite3'));
 copyRuntimeTree('better-sqlite3',sqliteRoot,dir);
 const result=run(dir,`import Database from 'better-sqlite3';import {sqliteKernel} from '@jini-ai/db/kernel/sqlite';import {ensureChatHistoryTables,createSqliteChatStore} from '@jini-ai/chat/store/sqlite';const db=new Database(':memory:');db.pragma('foreign_keys=ON');ensureChatHistoryTables({db});const s=createSqliteChatStore({kernel:sqliteKernel(db),scope:{scopeId:'s',ownerKind:'user',ownerId:'u'}});await s.create({id:'c'});await s.appendMessage({ conversationId: 'c', message: {id:'m',role:'user',content:'hello'} });console.log(JSON.stringify((await s.pageMessages({conversationId:'c'})).items.map(m=>m.content)));db.close();`);
 expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual(['hello']);
});
it('PGlite packed consumer runs without SQLite, pg or React',()=>{
 const dir=dirs.pglite!;copyPackage('@electric-sql/pglite',join(dbRoot,'node_modules/@electric-sql/pglite'),dir);
 const result=run(dir,`import {PGlite} from '@electric-sql/pglite';import {openPgliteKernel} from '@jini-ai/db/kernel/pglite';import {createPgliteChatStore} from '@jini-ai/chat/store/pglite';import {sql} from 'kysely';const k=openPgliteKernel({PGlite});for(const stmt of ${JSON.stringify(readFileSync(join(packageRoot,'src/store/__tests__/pg-schema.sql'),'utf8'))}.split(';').map(s=>s.trim()).filter(Boolean))await k.execute(sql.raw(stmt));const s=createPgliteChatStore({kernel:k,scope:{scopeId:'s',ownerKind:'user',ownerId:'u'}});await s.create({id:'c'});console.log(JSON.stringify((await s.pageConversations({})).items.map(c=>c.id)));await k.close();`);
 expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual(['c']);
 for(const name of ['better-sqlite3','pg','react'])expect(run(dir,`await import(${JSON.stringify(name)})`).status).not.toBe(0);
});

it('unavailable SQL adapters fail clearly while neutral and core remain usable',()=>{
 const result=run(dirs.neutral!,`const codes=[];for(const name of ['sqlite','pglite','postgres']){try{await import('@jini-ai/chat/store/'+name);}catch(error){codes.push(error.code);}}const {ChatStoreError}=await import('@jini-ai/chat/store');const {isTerminalRunStatus}=await import('@jini-ai/chat/core');console.log(JSON.stringify([codes,new ChatStoreError({ code: 'unavailable' }).code,isTerminalRunStatus({ status: 'succeeded' })]));`);
 expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual([['ERR_MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'],'unavailable',true]);
});
it('Postgres packed consumer constructs with injected pg, without SQLite, PGlite or React',()=>{
 const dir=dirs.postgres!;copyRuntimeTree('pg',join(dbRoot,'node_modules/pg'),dir);
 const result=run(dir,`import pg from 'pg';import {openPostgresKernel} from '@jini-ai/db/kernel/postgres';import {createPostgresChatStore} from '@jini-ai/chat/store/postgres';const k=openPostgresKernel({pg});const s=createPostgresChatStore({kernel:k,scope:{scopeId:'s',ownerKind:'user',ownerId:'u'}});console.log(JSON.stringify([k.transport,typeof s.pageConversations]));await k.close();`);
 expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual(['node-postgres','function']);
 for(const name of ['better-sqlite3','@electric-sql/pglite','react'])expect(run(dir,`await import(${JSON.stringify(name)})`).status).not.toBe(0);
});

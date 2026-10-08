/** C2 packed old-name root and declaration imports work without autoloading a driver. */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { copyPackage,fixture,pack,packages,run } from './packed-fixture.js';
import { remainingSurface as old } from './remaining-surface.js';
it('packed old root loads without any driver and requires explicit injection for acquisition',()=>{
 const dir=fixture('c2-shim-packed-');try{
  for(const name of ['core','protocol','db','chat','daemon','registry','diagnostics','sqlite'])pack(dir,name);
  copyPackage(dir,'kysely',join(packages,'db/node_modules/kysely'));
  const result=run(dir,`const a=await import('@jini-ai/sqlite');const errors=[];for(const action of [()=>a.createSqliteEventLog({ db: undefined })]){try{action();}catch(error){errors.push(error.message);}}console.log(JSON.stringify([Object.keys(a).sort(),errors,a.parseJsonOrUndef('{"x":1}')]));`);
  expect(result.status, result.stderr).toBe(0);expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual([old.filter(e=>e.runtime).map(e=>e.name).sort(),['createSqliteEventLog: pass a borrowed SqliteDb'],{x:1}]);
  for(const driver of ['better-sqlite3','pg','@electric-sql/pglite','react']) {
   const missing=run(dir,`await import(${JSON.stringify(driver)})`);expect(missing.status).not.toBe(0);expect(missing.stderr).toContain('ERR_MODULE_NOT_FOUND');
  }
  writeFileSync(join(dir,'consumer.ts'),`import type {${old.filter(e=>!e.runtime).map(e=>e.name).join(',')}} from '@jini-ai/sqlite';\nimport { CHAT_HISTORY_DDL,row,rows,parseJsonOrUndef,listMessages } from '@jini-ai/sqlite';\ndeclare const db:SqliteDb; declare const log:SqliteEventLog;const entry:Promise<import('@jini-ai/protocol').EventLogEntry>=log.append({runId:'r',event:'probe',data:1}); listMessages({db,conversationId:'c'});void entry;void [CHAT_HISTORY_DDL,row,rows,parseJsonOrUndef];`);
  const req=createRequire(join(packages,'sqlite/package.json'));
  const compile=spawnSync(process.execPath,[req.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','consumer.ts'],{cwd:dir,encoding:'utf8'});
  expect(compile.stdout+compile.stderr).toBe('');expect(compile.status).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
},60_000);

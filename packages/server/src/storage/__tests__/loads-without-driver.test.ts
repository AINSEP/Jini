/** C2 plain Node packed server memory boot proves it cannot autoload a SQLite driver. */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { fixture,pack,copyRuntimeTree,packages,run } from '../../__tests__/fixtures/packed-fixture.js';
it('memory composition runs from the packed server with no SQLite, pg, PGlite or React installed',()=>{
 const dir=fixture('c2-server-memory-');try {
  // Copy installed hard dependencies recursively, then replace server with its actual offline pack.
  copyRuntimeTree(dir,'@jini-ai/server',join(packages,'server'));
  pack(dir,'server');
  const result=run(dir,`const {composeJiniKernel}=await import('@jini-ai/server');const {installRouteRegistrationGuard}=await import('@jini-ai/http-kit');const {default:express}=await import('express');const app=express();installRouteRegistrationGuard({app});const k=await composeJiniKernel({app,security:{mode:'host'},adapter:{resolvedPortRef:{current:0}},storage:{kind:'memory'},profile:'agent-core-v1',features:{delegatedToolCalls:false}});const entry=await k.base.eventLog.append({runId:'r',event:'probe',data:1});const replay=await k.base.eventLog.replay({runId:'r',afterCursor:null});console.log(JSON.stringify([k.base.sqlite,entry.data,replay.kind]));await k.close();await k.close();`);
  expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toEqual([null,1,'ok']);
  for(const peer of ['better-sqlite3','pg','@electric-sql/pglite','react']) {
   const missing=run(dir,`await import(${JSON.stringify(peer)})`);expect(missing.status).not.toBe(0);expect(missing.stderr).toContain('ERR_MODULE_NOT_FOUND');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},60_000);

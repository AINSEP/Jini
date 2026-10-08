/** C2 registry neutral catalog and borrowed adapter work as actual packed entries. */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { fixture,pack,packages,copyRuntimeTree,run } from '../../../../../scripts/testing/packed-fixture.js';
it('neutral/adapter imports need no driver/db/Kysely/React and FTS runs with the injected host driver',()=>{
 const dir=fixture('c2-registry-packed-');try {
  pack(dir,'registry');
  let result=run(dir,`await import('@jini-ai/registry/tool-catalog');const a=await import('@jini-ai/registry/tool-catalog/sqlite');console.log(typeof a.searchToolCatalog);`);
  expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout.trim()).toBe('function');
  for(const peer of ['better-sqlite3','@jini-ai/db','kysely','react']) {
   const missing=run(dir,`await import(${JSON.stringify(peer)})`);expect(missing.status).not.toBe(0);expect(missing.stderr).toContain('ERR_MODULE_NOT_FOUND');
  }
  copyRuntimeTree(dir,'better-sqlite3',join(packages,'db/node_modules/better-sqlite3'));
  result=run(dir,`import Database from 'better-sqlite3';import {ensureToolCatalogTables,reseedToolCatalog,searchToolCatalog,getToolCatalogEntry} from '@jini-ai/registry/tool-catalog/sqlite';const db=new Database(':memory:');ensureToolCatalogTables({ db });reseedToolCatalog({ db, entries: [{id:'page.edit',description:'Edit pages',source:'plugin',inputSchema:{type:'object'}}] });console.log(JSON.stringify([searchToolCatalog({ db, query: 'edit' }).map(x=>x.id),getToolCatalogEntry({ db, id: 'page.edit' })]));db.close();`);
  expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toEqual([['page.edit'],{id:'page.edit',description:'Edit pages',source:'plugin',inputSchema:{type:'object'}}]);
 }finally{rmSync(dir,{recursive:true,force:true});}
},30_000);

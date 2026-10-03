import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require=createRequire(import.meta.url);
it('old eight-method fakes compile and every factory accepts host extra tables but refuses missing tables',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));const dir=mkdtempSync(join(tmpdir(),'chat-types-'));
 try{
  const paths={
   '@jini-ai/db/kernel':[join(root,'../db/dist/kernel/index.d.ts')],
   '@jini-ai/db/kernel/sqlite':[join(root,'../db/dist/kernel/sqlite/index.d.ts')],
   '@jini-ai/db/sqlite':[join(root,'../db/dist/sqlite/index.d.ts')],
   'kysely':[join(root,'../db/node_modules/kysely/dist/index.d.ts')],
  };
  writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{noEmit:true,types:[],paths},include:[join(root,'src/store/__tests__/types.fixture.ts')],exclude:[]}));
  const result=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',join(dir,'tsconfig.json')],{encoding:'utf8'});
  expect(result.stdout+result.stderr).toBe('');expect(result.status).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

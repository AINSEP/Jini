/** C2 real PGlite socket contract: port test, not run in the sandbox. */
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPgliteOwner } from '@jini-ai/db/pglite';
import { openPgliteSocketKernel } from '@jini-ai/db/kernel/postgres';
import type { AgentSessionDatabase } from '../sql.js';
import { createPgliteAgentSessionStore } from '../pglite.js';
import { schema } from './fixtures.js';
import { sqlSessionContract } from './sql-contract.js';
sqlSessionContract(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'c2-session-socket-'));
 const owner=await startPgliteOwner({PGlite,dataDir:join(dir,'data'),lockFileName:'sessions.lock',runDirName:'sessions'},{socketDir:join(dir,'sock')});
 const kernel=openPgliteSocketKernel<AgentSessionDatabase>({pg,socketPath:owner.socketPath});
 const close=async()=>{try{await kernel.close();await owner.close();}finally{rmSync(dir,{recursive:true,force:true});}};
 try{await schema(kernel);return {kernel,store:createPgliteAgentSessionStore({kernel}),close};}
 catch(error){await close();throw error;}
},createPgliteAgentSessionStore);

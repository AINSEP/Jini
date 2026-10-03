import { afterEach, expect, it, vi } from 'vitest';
import { sqliteFixture, type Fixture } from './fixtures.js';
import { createSqliteChatStore, createSqliteChatMaintenance } from '../sqlite/index.js';
import { createPgliteChatStore, createPgliteChatMaintenance } from '../pglite/index.js';
import { createPostgresChatStore, createPostgresChatMaintenance } from '../postgres/index.js';
const scope={scopeId:'ws',ownerKind:'user',ownerId:'alice'} as const;
let f:Fixture;afterEach(async()=>{vi.restoreAllMocks();await f?.close();});
it('construction borrows the exact kernel without SQL, configuration or resource lifecycle effects',async()=>{
 f=await sqliteFixture();const run=vi.spyOn(f.kernel,'run'),execute=vi.spyOn(f.kernel,'execute'),close=vi.spyOn(f.kernel,'close');
 const s=createSqliteChatStore({kernel:f.kernel,scope});createSqliteChatMaintenance({kernel:f.kernel});
 expect(run).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 await s.create({id:'c'});expect((await f.make(scope).get({ id: 'c' }))?.id).toBe('c');
});
// Reflect.apply supplies deliberately invalid runtime inputs without asserting valid port types.
it('factories reject wrong dialect and transport without touching the database',async()=>{
 f=await sqliteFixture();const run=vi.spyOn(f.kernel,'run');
 for(const [create,maintenance] of [[createSqliteChatStore,createSqliteChatMaintenance],[createPgliteChatStore,createPgliteChatMaintenance],[createPostgresChatStore,createPostgresChatMaintenance]] as const){
  const kernel={...f.kernel,dialect:'wrong',transport:'wrong'};
  expect(()=>Reflect.apply(create,undefined,[{kernel,scope}])).toThrow('Invalid chat store input.');
  expect(()=>Reflect.apply(maintenance,undefined,[{kernel}])).toThrow('Invalid chat store input.');
 }
 for(const [create,maintenance,dialect] of [[createSqliteChatStore,createSqliteChatMaintenance,'sqlite'],[createPgliteChatStore,createPgliteChatMaintenance,'postgres'],[createPostgresChatStore,createPostgresChatMaintenance,'postgres']] as const){
  const kernel={...f.kernel,dialect,transport:'wrong'};
  expect(()=>Reflect.apply(create,undefined,[{kernel,scope}])).toThrow('Invalid chat store input.');
  expect(()=>Reflect.apply(maintenance,undefined,[{kernel}])).toThrow('Invalid chat store input.');
 }
 expect(run).not.toHaveBeenCalled();
});
it('operation failures are structured and keep original causes without identifiers in messages',async()=>{
 f=await sqliteFixture();const s=f.make(scope);const cause=new Error('driver detail');
 vi.spyOn(f.kernel,'run').mockRejectedValueOnce(cause);
 await expect(s.list()).rejects.toMatchObject({name:'ChatStoreError',code:'unavailable',message:'Chat store unavailable.',cause});
});
it('invalid scopes fail before construction can issue a read',async()=>{
 f=await sqliteFixture();const run=vi.spyOn(f.kernel,'run');
 for(const bad of [{...scope,ownerKind:'admin'},{...scope,ownerId:''},{...scope,scopeId:''}]){
  expect(()=>Reflect.apply(createSqliteChatStore,undefined,[{kernel:f.kernel,scope:bad}])).toThrow('Invalid chat store input.');
 }
 expect(run).not.toHaveBeenCalled();
});

/** C1 file compatibility: borrowed adapters neither rewrite schema nor convert legacy rows. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openFileSqliteTestKernel } from '@jini-ai/db/testing/sqlite';
import { createSqliteChatStore, ensureChatHistoryTables } from '../sqlite/index.js';
import type { ChatDatabase } from '../sql/tables.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };
const scope={scopeId:'ws',ownerKind:'user',ownerId:'alice'} as const;
it('reopening existing rows leaves schema, values and host ledger untouched',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-reopen-'));const path=join(dir,'chat.sqlite');let opened=openFileSqliteTestKernel<ChatDatabase>({ path });let db=opened.connection;
 try{
  ensureChatHistoryTables({ db });
  db.exec('CREATE TABLE host_migrations (id TEXT PRIMARY KEY, checksum TEXT); INSERT INTO host_migrations VALUES (\'frozen\',\'bytes\')');
  const s=createSqliteChatStore({ kernel: opened.kernel, scope, clock: { nowMs: ()=>1790000000000 } });await s.create({id:'c',title:'retained',expiresAt:1790000000100});
  await s.appendMessage({ conversationId: 'c', message: {id:'m',role:'assistant',content:'old text',createdAt:1790000000001} });
  db.prepare('UPDATE ai_chat_messages SET events_json=? WHERE id=?').run('{legacy damage','m');
  const snapshot=()=>({schema:db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all(),chats:db.prepare('SELECT * FROM ai_chats').all(),messages:db.prepare('SELECT * FROM ai_chat_messages').all(),ledger:db.prepare('SELECT * FROM host_migrations').all(),foreignKeys:db.pragma('foreign_keys',{simple:true})});
  const before=snapshot();await opened.close();opened=openFileSqliteTestKernel<ChatDatabase>({ path });db=opened.connection;
  const store=createSqliteChatStore({ clock: testClock,kernel:opened.kernel,scope});
  expect(snapshot()).toEqual(before);
  expect(await store.pageMessages({conversationId:'c'})).toEqual({items:[{id:'m',role:'assistant',content:'old text',createdAt:1790000000001}]});
  expect((await store.get({ id: 'c' }))?.title).toBe('retained');expect(snapshot()).toEqual(before);
 }finally{await opened.close();rmSync(dir,{recursive:true,force:true});}
});

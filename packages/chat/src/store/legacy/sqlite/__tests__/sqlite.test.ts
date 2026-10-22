/** C2 preserves synchronous local-project chat and mismatch isolation, distinct from ai_* history. */
import Database from 'better-sqlite3';
import { expect,it } from 'vitest';
import { LEGACY_CHAT_DDL,insertConversation,getConversation,upsertMessage,listMessages,deleteConversation,MessageConversationMismatchError } from '../index.js';
it('sync legacy CRUD retains the stored schema and cascades messages',()=>{
 const db=new Database(':memory:');try {
  db.pragma('foreign_keys=ON');db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES (\'p\');'+LEGACY_CHAT_DDL);
  insertConversation({ db: db, c: {id:'c',projectId:'p',title:'Local',sessionMode:'plan',createdAt:1,updatedAt:1} });
  expect(getConversation({ db: db, id: 'c' })?.sessionMode).toBe('plan');
  upsertMessage({ db: db, conversationId: 'c', m: {id:'m',role:'user',content:'legacy',attachments:[{name:'a'}]} });
  const messages=listMessages({ db: db, conversationId: 'c' });expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({id:'m',role:'user',content:'legacy',attachments:[{name:'a'}]});
  expect(messages instanceof Promise).toBe(false);
  deleteConversation({ db: db, id: 'c' });expect(listMessages({ db: db, conversationId: 'c' })).toEqual([]);expect(getConversation({ db: db, id: 'c' })).toBeNull();
 }finally{db.close();}
});
it('a colliding message id cannot overwrite a different legacy conversation',()=>{
 const db=new Database(':memory:');try {
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES (\'p\');'+LEGACY_CHAT_DDL);
  for(const id of ['a','b'])insertConversation({ db: db, c: {id,projectId:'p',createdAt:1,updatedAt:1} });
  upsertMessage({ db: db, conversationId: 'a', m: {id:'global',role:'user',content:'private'} });
  expect(()=>upsertMessage({ db: db, conversationId: 'b', m: {id:'global',role:'user',content:'attack'} })).toThrow(MessageConversationMismatchError);
  expect(listMessages({ db: db, conversationId: 'a' })[0]?.content).toBe('private');expect(listMessages({ db: db, conversationId: 'b' })).toEqual([]);
 }finally{db.close();}
});

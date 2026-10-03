/** C2 the actual host driver's sync API is structural, and a transaction rolls back atomically. */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { SqliteDb } from '../../sqlite/sync-types.js';
it('sync public declarations contain no driver import',()=>{
  const source=readFileSync(new URL('../../sqlite/sync-types.ts',import.meta.url),'utf8');
  expect(source).not.toMatch(/import\s+(?:type\s+)?[^;]*from\s+['"]better-sqlite3['"]/);
});
it('a host Database satisfies typed prepare/get/all/transaction/pragma contracts',()=>{
  const host=new Database(':memory:');
  const db:SqliteDb=host;
  try {
    db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY, value INTEGER NOT NULL)');
    const insert=db.prepare<[string,number]>('INSERT INTO sample VALUES (?,?)');
    const statement=db.prepare<[string],{id:string,value:number}>('SELECT * FROM sample WHERE id=?');
    const failure=new Error('rollback');
    const transaction=db.transaction((value:number)=>{insert.run('x',value);throw failure;});
    expect(()=>transaction.immediate(1)).toThrow(failure);
    expect(statement.get('x')).toBeUndefined();expect(statement.all('x')).toEqual([]);
    db.transaction((value:number)=>insert.run('x',value))(2);
    expect(statement.get('x')).toEqual({id:'x',value:2});
    expect([...statement.iterate('x')]).toEqual([{id:'x',value:2}]);
    expect(db.pragma('foreign_keys',{simple:true})).toBe(1);
  } finally {db.close();}
});

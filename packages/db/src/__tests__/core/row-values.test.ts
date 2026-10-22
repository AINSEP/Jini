/** C2 unchanged pure helpers from the old public db/core surface. */
import { expect, it } from 'vitest';
import { parseJsonOrUndef, row, rows } from '../../core/row-values.js';
it('tolerates invalid JSON while retaining every valid JSON value',()=>{
  for(const value of [undefined,null,42,{},'', '{bad']) expect(parseJsonOrUndef(value)).toBeUndefined();
  for(const value of [null,false,0,'',[],{nested:[1,'x']}]) expect(parseJsonOrUndef(JSON.stringify(value))).toEqual(value);
});
it('row and rows preserve object identity and positions without changing input',()=>{
  const object={x:1}, input=[object,null,false,undefined,[],1];
  expect(row(object)).toBe(object);expect(row(null)).toBeNull();expect(row(0)).toBeNull();
  const result=rows(input);expect(result).toEqual([object,{},{},{},[],{}]);
  expect(result[0]).toBe(object);expect(input).toEqual([object,null,false,undefined,[],1]);
});

/** C2 singleton acquisition is host injected; failed bootstrap cannot leak a handle. */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { openDatabase, closeDatabase } from '../legacy/sqlite.js';
it('openDatabase requires an explicit opener and cleans up a failed schema bootstrap', () => {
  const dir=mkdtempSync(join(tmpdir(),'c2-legacy-fail-'));
  const db=new Database(':memory:');
  const failure=new Error('legacy schema denied');
  const close=vi.spyOn(db,'close');vi.spyOn(db,'exec').mockImplementation(()=>{throw failure;});
  try {
    expect(()=>openDatabase({ projectRoot: dir, open: () => db }, { dataDir: dir })).toThrow(failure);
    expect(close).toHaveBeenCalledTimes(1);expect(db.open).toBe(false);
  } finally { closeDatabase();if(db.open)db.close();rmSync(dir,{recursive:true,force:true}); }
});
it('openDatabase has no ambient driver',()=>{
  const dir=mkdtempSync(join(tmpdir(),'c2-no-opener-'));
  try { expect(()=>openDatabase({ projectRoot: dir } as never)).toThrow('openDatabase: inject options.open'); }
  finally { closeDatabase();rmSync(dir,{recursive:true,force:true}); }
});

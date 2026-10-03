/** C2: a host-supplied SQLite driver owns every acquired handle, including failed boots. */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createJiniKernelBase } from '../../kernel-base.js';

it('opens exactly three host handles and closes them once on shutdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c2-host-'));
  const handles: Database.Database[] = [];
  const open = vi.fn((file: string) => { const db = new Database(file); handles.push(db); return db; });
  try {
    const base = await createJiniKernelBase({ storage: { kind: 'sqlite', dataDir: dir, open } } as any);
    try {
      expect(open.mock.calls.map(([file]) => file)).toEqual([join(dir,'events.db'), join(dir,'journal.db'), join(dir,'events.db')]);
      const closes = handles.map(db => vi.spyOn(db, 'close'));
      await base.close(); await base.close();
      expect(handles.map(db => db.open)).toEqual([false,false,false]);
      expect(closes.map(close => close.mock.calls.length)).toEqual([1,1,1]);
    } finally { await base.close(); }
  } finally { handles.forEach(db => { if(db.open) db.close(); }); rmSync(dir, { recursive:true,force:true }); }
});

it('third acquisition failure closes both previously acquired event logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c2-host-fail-'));
  const handles: Database.Database[] = [];
  const failure = new Error('host third connection denied');
  const open = vi.fn((file: string) => {
    if(handles.length===2) throw failure;
    const db = new Database(file); handles.push(db); return db;
  });
  let base: Awaited<ReturnType<typeof createJiniKernelBase>> | undefined;
  try {
    const boot = createJiniKernelBase({ storage: { kind:'sqlite',dataDir:dir,open } } as any).then(value => {base=value;return value;});
    await expect(boot).rejects.toThrow(failure);
    expect(handles.map(db => db.open)).toEqual([false,false]);
  } finally { await base?.close(); handles.forEach(db=>{if(db.open)db.close();}); rmSync(dir,{recursive:true,force:true}); }
});

it('memory boot does not invoke even an available host opener', async () => {
  const open=vi.fn(()=>{throw new Error('must not acquire');});
  const base=await createJiniKernelBase({storage:{kind:'memory',open}} as any);
  expect(base.sqlite).toBeNull();expect(open).not.toHaveBeenCalled();await base.close();
});

it('failed feature-connection pragma closes all three already acquired handles',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'c2-feature-pragma-'));const handles:Database.Database[]=[];
 const failure=new Error('feature pragma denied');
 const open=(file:string)=>{const db=new Database(file);handles.push(db);if(handles.length===3)vi.spyOn(db,'pragma').mockImplementation(()=>{throw failure;});return db;};
 try{
  await expect(createJiniKernelBase({storage:{kind:'sqlite',dataDir:dir,open}})).rejects.toThrow(failure);
  expect(handles.map(db=>db.open)).toEqual([false,false,false]);
 }finally{handles.forEach(db=>{if(db.open)db.close();});rmSync(dir,{recursive:true,force:true});}
});

it.each(['boot','shutdown'] as const)('attempts every owned close when an event-log closer throws during %s',async phase=>{
 const dir=mkdtempSync(join(tmpdir(),'c2-close-failure-'));const handles:Database.Database[]=[];
 const bootFailure=new Error('third host open denied'),closeFailure=new Error('first host close denied');
 const open=(file:string)=>{if(phase==='boot'&&handles.length===2)throw bootFailure;const db=new Database(file);handles.push(db);return db;};
 let base:Awaited<ReturnType<typeof createJiniKernelBase>>|undefined;
 const closers:ReturnType<typeof vi.spyOn>[]=[];
 try {
  if(phase==='boot'){
   const injected=(file:string)=>{const db=open(file);const close=db.close.bind(db);closers.push(vi.spyOn(db,'close').mockImplementation(()=>{close();if(handles.length===2&&db===handles[0])throw closeFailure;return db;}));return db;};
   await expect(createJiniKernelBase({storage:{kind:'sqlite',dataDir:dir,open:injected}})).rejects.toBe(bootFailure);
  }else{
   base=await createJiniKernelBase({storage:{kind:'sqlite',dataDir:dir,open}});
   for(const db of handles){const close=db.close.bind(db);closers.push(vi.spyOn(db,'close').mockImplementation(()=>{close();if(db===handles[0])throw closeFailure;return db;}));}
   await expect(base.close()).rejects.toBe(closeFailure);
   await expect(base.close()).rejects.toBe(closeFailure);
  }
  expect(handles.map(db=>db.open)).toEqual(phase==='boot'?[false,false]:[false,false,false]);
  expect(closers.map(close=>close.mock.calls.length)).toEqual(phase==='boot'?[1,1]:[1,1,1]);
 }finally{closers.forEach(close=>close.mockRestore());handles.forEach(db=>{if(db.open)db.close();});rmSync(dir,{recursive:true,force:true});}
});

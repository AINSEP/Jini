/** C2 snapshot includes every runtime AND erased type name from actual pre-removal 0.3.x source. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect,it } from 'vitest';
import * as shim from '../index.js';
import { remainingSurface as old, serverOwnedNames } from './remaining-surface.js';
it('preserves the remaining runtime surface and removes server composition',()=>{
 expect(Object.keys(shim).sort()).toEqual(old.filter(e=>e.runtime).map(e=>e.name).sort());
 expect('MessageConversationMismatchError' in shim).toBe(false);
 // REGRESSION: fails if any server-owned compatibility re-export is restored.
 for (const name of serverOwnedNames) expect(name in shim).toBe(false);
});
it.each(['../index.ts', '../../dist/index.d.ts'])('preserves every frozen declaration name in %s, including DDL, helpers and CRUD',path=>{
 const root=ts.createSourceFile('index.d.ts',readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const names=root.statements.flatMap(node=>ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)?node.exportClause.elements.map(e=>({name:e.name.text,runtime:!node.isTypeOnly&&!e.isTypeOnly})):[]);
 expect(names.sort((a,b)=>a.name.localeCompare(b.name))).toEqual(old);
});
it('the shim has no driver dependencies or runtime references to the removed package',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 expect(manifest.name).toBe('@jini-ai/sqlite');
 // Owner decision (2026-11-01, #8): freeze the shim API, publish its version with the Jini lockstep.
 expect(manifest.version).toBe(JSON.parse(readFileSync(new URL('../../../core/package.json', import.meta.url), 'utf8')).version);
 expect(Object.keys(manifest.dependencies).sort()).toEqual(['@jini-ai/chat','@jini-ai/daemon','@jini-ai/db','@jini-ai/registry']);
 expect(readFileSync(new URL('../index.ts',import.meta.url),'utf8')).not.toContain('sqlite-chat');
});

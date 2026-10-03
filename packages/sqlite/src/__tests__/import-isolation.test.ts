/** C2 isolation uses TypeScript's parser, including positive-control forbidden imports. */
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

function runtimeImports(text: string): string[] {
  const source=ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true);
  const imports:string[]=[];
  function visit(node:ts.Node) {
    if(ts.isImportDeclaration(node) && (!node.importClause || !node.importClause.isTypeOnly)) {
      const binding=node.importClause?.namedBindings;
      const onlyTypes=binding && ts.isNamedImports(binding) && !node.importClause?.name && binding.elements.every(e=>e.isTypeOnly);
      if(!onlyTypes && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    }
    if(ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const onlyTypes=node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(e=>e.isTypeOnly);
      if(!onlyTypes) imports.push(node.moduleSpecifier.text);
    }
    if(ts.isCallExpression(node) && (node.expression.kind===ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text==='require'))) {
      const spec=node.arguments[0];if(spec && ts.isStringLiteralLike(spec)) imports.push(spec.text);
    }
    ts.forEachChild(node,visit);
  }
  visit(source);return imports;
}
function files(dir:string):string[] {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=> e.isDirectory() ? (['node_modules','dist','__tests__','testing'].includes(e.name)?[]:files(join(dir,e.name))) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [join(dir,e.name)] : []);
}
const packages=fileURLToPath(new URL('../../../',import.meta.url));
it('scanner detects static import, re-export, require and dynamic import but permits erased types',()=>{
  expect(runtimeImports(`import D from 'better-sqlite3'; export {x} from 'pg'; const p=import('@electric-sql/pglite'); const q=require('@libsql/client'); import type {Pool} from 'pg';import {type Y} from 'pg';export type {X} from 'pg';`)).toEqual(['better-sqlite3','pg','@electric-sql/pglite','@libsql/client']);
});
it('moved code and server never import a driver value, old implementation or compatibility shim',()=>{
  const roots=['db/src','chat/src/store','daemon/src','registry/src','server/src'];
  const forbidden=/^(better-sqlite3|pg|@electric-sql\/pglite|@libsql\/client|@jini-ai\/sqlite(?:-chat)?)(?:\/|$)/;
  const violations=roots.flatMap(root=>files(join(packages,root)).flatMap(file=>runtimeImports(readFileSync(file,'utf8')).filter(name=>forbidden.test(name)).map(name=>`${file}: ${name}`)));
  expect(violations).toEqual([]);
});

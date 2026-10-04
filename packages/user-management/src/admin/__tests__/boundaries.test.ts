import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { it, expect } from 'vitest';
const root=fileURLToPath(new URL('../../',import.meta.url));
it('core and server import closures never reach React, admin, or browser ui-kit',()=>{
  const visited=new Set<string>();
  function visit(file:string){
    if(visited.has(file))return;visited.add(file);
    const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function inspect(node:ts.Node){
      let specifier:string|undefined;
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))specifier=node.moduleSpecifier.text;
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){const arg=node.arguments[0];expect(arg&&ts.isStringLiteral(arg)).toBe(true);if(arg&&ts.isStringLiteral(arg))specifier=arg.text;}
      if(specifier){expect(specifier,file).not.toMatch(/^(react(?:-dom)?(?:\/|$)|@jini-ai\/(?:admin|ui(?:-kit)?)(?:\/|$))/);
        if(specifier.startsWith('.'))visit(resolve(dirname(file),specifier.replace(/\.js$/,'.ts')));
      }
      ts.forEachChild(node,inspect);
    }
    inspect(ast);
  }
  visit(resolve(root,'core/index.ts'));visit(resolve(root,'server/index.ts'));expect(visited.size).toBeGreaterThan(20);
});
it('admin framework-free files stay separate and React uses only public admin module exports',()=>{
  function visit(dir:string){for(const item of readdirSync(dir,{withFileTypes:true})){
    if(item.name==='__tests__')continue;const file=resolve(dir,item.name);
    if(item.isDirectory()){visit(file);continue;}if(!/\.tsx?$/.test(file))continue;
    const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function inspect(node:ts.Node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
      const s=node.moduleSpecifier.text;
      if(!file.includes('/admin/react/'))expect(s,file).not.toMatch(/^(react|@jini-ai\/(?:ui(?:-kit)?\/react|ui(?:\/|$)))/);
      if(s.startsWith('@jini-ai/admin'))expect(s,file).toBe('@jini-ai/admin/core/module');
      expect(s,file).not.toMatch(/@jini-ai\/(?:[^/]+)\/(?:src|dist)\//);
    }ts.forEachChild(node,inspect);}
    inspect(ast);
  }}visit(resolve(root,'admin'));
});
it('people React render files contain no raw controls, hooks stay in hooks, and admin entry stays headless',()=>{
  const admin=resolve(root,'admin');
  function inspect(dir:string){for(const item of readdirSync(dir,{withFileTypes:true})){
    if(item.name==='__tests__')continue;const file=resolve(dir,item.name);
    if(item.isDirectory()){inspect(file);continue;}if(!/\.tsx?$/.test(file))continue;
    if(/\.hooks\.ts$/.test(file))expect(dirname(file)).toBe(resolve(admin,'react/hooks'));
    if(file.endsWith('.tsx'))expect(readFileSync(file,'utf8'),file).not.toMatch(/<(?:button|input|select)(?:\s|>)/);
    if(!file.includes('/react/'))expect(readFileSync(file,'utf8'),file).not.toMatch(/from ['"](?:react|.*\/react\/|@jini-ai\/ui-kit\/react)/);
  }}inspect(admin);
});

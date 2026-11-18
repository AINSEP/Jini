/** C1 dependency closure: AST scan with positive controls for every import form. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root=fileURLToPath(new URL('../',import.meta.url));
/** The store may name only core, protocol and itself among Jini packages: every other one is a host's to bind. */
const foreignJini=(spec:string)=>spec.startsWith('@jini-ai/')&&!/^@jini-ai\/(core|protocol|chat)(\/|$)/.test(spec);
const forbidden=['kysely','better-sqlite3','pg','@electric-sql/pglite','react','react-dom'];
function imports(source:string):string[]{
 const result:string[]=[];const tree=ts.createSourceFile('probe.ts',source,ts.ScriptTarget.Latest,true);
 function visit(n:ts.Node){
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))result.push(n.moduleSpecifier.text);
  if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0]))result.push(n.arguments[0].text);
  if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)&&ts.isStringLiteral(n.argument.literal))result.push(n.argument.literal.text);
  ts.forEachChild(n,visit);
 }visit(tree);return result;
}
function closure(entry:string,seen=new Set<string>()):string[]{
 if(seen.has(entry))return [];seen.add(entry);
 const violations:string[]=[];
 for(const spec of imports(readFileSync(entry,'utf8'))){
  if(spec.startsWith('.')){
   let target=resolve(dirname(entry),spec.replace(/\.js$/,'.ts'));
   if(!existsSync(target))target=resolve(dirname(entry),spec,'index.ts');
   violations.push(...closure(target,seen));
  }else if(spec.startsWith('node:')||foreignJini(spec)||forbidden.some(p=>spec===p||spec.startsWith(`${p}/`)))violations.push(spec);
 }
 return violations;
}
it('neutral store has no SQL, driver, React or Node dependency, including type imports',()=>{
 expect(closure(resolve(root,'index.ts'))).toEqual([]);
});
it.each([
 'import { sql } from "kysely";',
 'export * from "react";',
 'const x = import("pg");',
 'import type { StorageKernel } from "@jini-ai/db/kernel";',
 'export { classifyAgentServiceFailure } from "@jini-ai/agent-runtime";',
 'type P = import("@electric-sql/pglite").PGlite;',
])('positive control catches forbidden imports in %s',source=>{
 const found=imports(source);expect(found).toHaveLength(1);
 expect(foreignJini(found[0]!)||forbidden.some(p=>found[0]===p||found[0]!.startsWith(`${p}/`))).toBe(true);
});
it('allows core, protocol and chat itself', () => {
 for (const spec of ['@jini-ai/core','@jini-ai/core/contracts/storage','@jini-ai/protocol','@jini-ai/chat/store']) expect(foreignJini(spec)).toBe(false);
 expect(foreignJini('@jini-ai/corex')).toBe(true);
});
it('does not mistake comments and string lookalikes for imports',()=>{
 expect(imports('// import pg from "pg";\nconst text = `import("react")`;')).toEqual([]);
});

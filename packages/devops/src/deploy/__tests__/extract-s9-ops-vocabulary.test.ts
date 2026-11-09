import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';

it('every moved deployment production string is neutral and imports use defining files or core',()=>{
 const files=['ops-runner.ts','ops-secrets.ts','ops-secret-card.ts','ops-tools.ts','ops-registry.ts','ops-tool-contracts.ts'];
 for(const name of files){
  const file=new URL('../'+name,import.meta.url);
  const source=ts.createSourceFile(name,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const visit=(node:ts.Node):void=>{
   if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)) expect(node.text,`${fileURLToPath(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line+1}`).not.toMatch(/tovu|custom_credential_|custom-credentials|credential_save|deployment_ops_|admin\.security|features\/|https?:\/\//i);
   if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
    expect(node.moduleSpecifier.text).toMatch(/^(?:@jini-ai\/core(?:\/|$)|node:|\.\/ops-)/);
    expect(node.moduleSpecifier.text).not.toMatch(/(?:^|\/)index\.js$/);
   }
   ts.forEachChild(node,visit);
  };visit(source);
 }
});

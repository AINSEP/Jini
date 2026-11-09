import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

/** This package may inspect its own source. Installed-consumer checks live in the host and resolve dist. */
test('all moved implementation literals are host-neutral and owning imports never use a package barrel', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.ts')) files.push(file);
    }
  }
  walk(root);
  expect(files.map(file => path.basename(file)).sort()).toEqual(['contract.ts', 'index.ts', 'install.ts', 'management.ts', 'source.ts']);
  const violations: string[] = [];
  const vocabulary = /tovu|admin\.plugins|plugins_(list|set_enabled|uninstall|install)|plugin_source_|native-escalation|features\/|https?:\/\//i;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && vocabulary.test(node.text)) violations.push(`${path.basename(file)}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${node.text}`);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const value = node.moduleSpecifier.text;
        if (/^@jini-ai\/plugins(?:\/|$)/.test(value) || /(?:^|\/)host\/(?:node\/)?index(?:\.js)?$/.test(value)) violations.push(`${path.basename(file)}: own barrel ${value}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(violations).toEqual([]);
});

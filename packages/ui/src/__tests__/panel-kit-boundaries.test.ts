// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const forbidden = /(?:@jini-ai\/(?:admin|cms|user-management)(?:\/|$)|@tovu|(?:^|\/)apps\/|#src\/)/;
function imports(source: string): string[] {
  const tree = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const value = node.arguments[0];
      if (value && ts.isStringLiteral(value)) result.push(value.text);
    }
    if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteral(node.expression)) result.push(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}
it('detects forbidden static, dynamic, type, require and re-export imports', () => {
  const fixture = `import type { X } from '@jini-ai/admin/core'; export * from '@jini-ai/cms'; import('@jini-ai/user-management'); require('../apps/admin/api'); import Y = require('#src/api');`;
  expect(imports(fixture).filter(value => forbidden.test(value))).toHaveLength(5);
});
it('keeps every production source independent of apps and admin/cms/user-management', () => {
  const files = sourceFiles(fileURLToPath(new URL('../', import.meta.url)));
  expect(files.length).toBeGreaterThan(0);
  const violations = files.flatMap(path => {
    const source = readFileSync(path, 'utf8');
    return imports(source).filter(value => forbidden.test(value)).map(value => `${path}: ${value}`);
  });
  expect(violations).toEqual([]);
});

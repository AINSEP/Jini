import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(filename);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [filename] : [];
  });
}

test('public functions, constructors and adapter methods accept named argument objects', () => {
  let checked = 0;
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const filename of sources(root)) {
    const ast = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = (node: ts.FunctionDeclaration | ts.ConstructorDeclaration | ts.MethodDeclaration) => {
      checked += 1;
      const label = `${filename}: ${ts.isConstructorDeclaration(node) ? 'constructor' : node.name?.getText(ast)}`;
      expect(node.parameters.length, label).toBeGreaterThan(0);
      expect(node.parameters.length, label).toBeLessThanOrEqual(2);
      for (const parameter of node.parameters) {
        expect(parameter.dotDotDotToken, label).toBeUndefined();
        expect(parameter.type, label).toBeDefined();
        if (!parameter.type) continue;
        const type = parameter.type;
        expect(ts.isTypeLiteralNode(type) || ts.isTypeReferenceNode(type) || ts.isIntersectionTypeNode(type), label).toBe(true);
      }
    };
    for (const statement of ast.statements) {
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isFunctionDeclaration(statement)) check(statement);
      if (ts.isClassDeclaration(statement)) {
        for (const member of statement.members) {
          if (!ts.isConstructorDeclaration(member) && !ts.isMethodDeclaration(member)) continue;
          if (ts.getModifiers(member)?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) continue;
          check(member);
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
});

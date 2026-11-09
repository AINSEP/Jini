import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';

it('every moved production string is neutral and imports use core or defining relative modules', () => {
  const directory = new URL('..', import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith('.ts'));
  expect(files.sort()).toEqual(['credential-copy-tool.ts', 'credential-tool-host.ts', 'credential-tool-operations.ts', 'index.ts', 'tool-registrations.ts']);
  for (const name of files) {
    const file = new URL(name, directory);
    const source = ts.createSourceFile(name, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) {
        expect(node.text, `${fileURLToPath(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
          .not.toMatch(/tovu|custom_credential_|custom-credentials|credential_save|deployment_ops_|admin\.security|features\/|https?:\/\//i);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        expect(node.moduleSpecifier.text).toMatch(/^(?:@jini-ai\/core(?:\/|$)|\.\.?\/)/);
        expect(node.moduleSpecifier.text).not.toMatch(/(?:^|\/)index\.js$/);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

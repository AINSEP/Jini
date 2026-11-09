import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('connect implementation imports its owning modules without reopening package barrels', () => {
  const directory = fileURLToPath(new URL('..', import.meta.url));
  const files = sourceFiles(directory);
  expect(files.length).toBeGreaterThan(9);
  const forbidden: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && /^@jini-ai\/agent-plugins\/(connect|lifecycle)(?:\/|$)/.test(node.text)) {
        forbidden.push(`${relative(directory, file)}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(forbidden).toEqual([]);
});

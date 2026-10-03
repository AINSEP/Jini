import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.name === '__tests__' || /\.test\./.test(entry.name)) return [];
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx|css)$/.test(file) ? [file] : [];
  });
}

it('keeps admin product-neutral and reads component colors from the variable contract', () => {
  for (const file of sourceFiles(path.resolve(__dirname, '../../..'))) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\.(?:tsx|css)$/.test(file)) expect(source, file).not.toMatch(/#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch)\(/i);
  }
});

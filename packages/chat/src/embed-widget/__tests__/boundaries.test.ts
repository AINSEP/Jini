import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe('package source boundaries', () => {
  it('keeps the browser extraction free of storage adapters, Node dependencies and browser globals', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const found = sources(root).flatMap(path => {
      const text = readFileSync(path, 'utf8');
      const invalid = /from\s+['"](?:node:|.*\/store\/|@jini-ai\/db|@jini-ai\/agent-runtime)|\b(?:globalThis|sessionStorage|localStorage)\b/.test(text);
      return invalid ? [path] : [];
    });
    expect(found).toEqual([]);
  });
});

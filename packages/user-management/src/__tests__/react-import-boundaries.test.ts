import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(filename);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [filename] : [];
  });
}



test('React screens have no direct transport, host module or Node dependency', () => {
  for (const filename of sources(path.join(root, 'react'))) {
    expect(readFileSync(filename, 'utf8'), filename).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|from\s+['"](?:node:|@\/)|from\s+['"][^'"]*\/server/);
  }
});

test('universal and server entries never reach the optional React entry', () => {
  for (const directory of ['core', 'server']) {
    for (const filename of sources(path.join(root, directory))) {
      expect(readFileSync(filename, 'utf8'), filename).not.toMatch(/from\s+['"](?:react(?:-dom)?|@jini-ai\/(?:ui|admin))|from\s+['"][^'"]*\/react\//);
    }
  }
});

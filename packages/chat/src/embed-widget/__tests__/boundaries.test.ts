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

function violatesBoundary(path: string, source: string): boolean {
  if (path === fileURLToPath(new URL('../browser/frontend-session-bridge.ts', import.meta.url))) {
    // 0.6.x compatibility: these two defaults predate required fetch injection;
    // remove when fetch injection becomes required in the next minor.
    source = source.replace('fetch ?? globalThis.fetch', 'fetch')
      .replace('fetch: send = globalThis.fetch, reconnectMs = 1000', 'fetch: send, reconnectMs = 1000')
      .replace('typeof globalThis.fetch', 'typeof fetch').replace('typeof globalThis.fetch', 'typeof fetch');
  }
  return /from\s+['"](?:node:|.*\/store\/|@jini-ai\/db|@jini-ai\/agent-runtime)|\b(?:globalThis|sessionStorage|localStorage)\b/.test(source);
}

describe('package source boundaries', () => {
  it('keeps the browser extraction free of storage adapters, Node dependencies and browser globals', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const found = sources(root).flatMap(path => {
      const text = readFileSync(path, 'utf8');
      const invalid = violatesBoundary(path, text);
      return invalid ? [path] : [];
    });
    expect(found).toEqual([]);
  });

  it.each(['globalThis.fetch', 'globalThis.other', 'localStorage', 'sessionStorage', "import x from 'node:fs'"])(
    'rejects additional boundary violations in the compatibility file: %s', extra => {
      const path = fileURLToPath(new URL('../browser/frontend-session-bridge.ts', import.meta.url));
      expect(violatesBoundary(path, `${readFileSync(path, 'utf8')}\n${extra}`)).toBe(true);
    },
  );

  it('rejects the same defaults outside their exact compatibility file', () => {
    expect(violatesBoundary('/browser/other.ts', 'fetch ?? globalThis.fetch')).toBe(true);
  });

  it.each(['AgentLab.tsx', 'WebMcpLab.tsx'])('injects fetch explicitly in the repo host %s', name => {
    const source = readFileSync(new URL(`../../../../../examples/reference-web/src/${name}`, import.meta.url), 'utf8');
    expect(source).toMatch(/createFrontendSessionBridge\(\{[^}]*\bfetch:/);
  });
});

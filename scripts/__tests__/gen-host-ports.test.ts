import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hostPortEntries, main, renderHostPorts } from '../gen-host-ports.js';

let root: string;
const put = (file: string, content: string | object): void => {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-host-ports-test-'));
  put('packages/daemon/package.json', { name: '@jini-ai/daemon' });
  put('packages/daemon/src/ports.ts', [
    'export interface LockPort { run(): void }',
    'export type ChatKit = { slot: string };',
    'export interface MediaDeps { clock: () => number }',
    'export function registerMedia(): void {}',
    'export function helper(): void {}',
    'interface HiddenPort { x: 1 }',
    'export const writerPort = { write: () => undefined };',
  ].join('\n'));
  put('packages/daemon/src/__tests__/skipped.ts', 'export interface TestOnlyPort { x: 1 }');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('lists exported ports, kits, deps and registry functions with their file and line, nothing else', () => {
  const found = hostPortEntries({ root }).map(entry => `${entry.name}:${entry.category}:${entry.line}`);
  expect(found).toEqual(['LockPort:port:1', 'ChatKit:kit:2', 'MediaDeps:deps:3', 'registerMedia:registry:4', 'writerPort:port:7']);
});

it('renders one table per package and detects a stale file with --check', () => {
  const text = renderHostPorts({ entries: hostPortEntries({ root }) });
  expect(text).toContain('## @jini-ai/daemon');
  expect(text).toContain('| `LockPort` | port | interface | `packages/daemon/src/ports.ts:1` |');
  expect(main(['--check'], { root })).toBe(1);
  expect(main([], { root })).toBe(0);
  expect(main(['--check'], { root })).toBe(0);
});

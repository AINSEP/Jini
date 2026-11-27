import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from 'vitest';
import { createBundledExportFilePolicy, type ClassifyBundledExportFile } from '../bundled-export-file-policy.js';

/** Neutral classifier: skip exactly when the installed copy has identical bytes. */
const classify: ClassifyBundledExportFile = async ({ pluginId, relativePath, bytes, readFile }) => {
  const installed = await readFile({ pluginId, relativePath }).catch(() => null);
  return installed !== null && Buffer.from(installed).equals(Buffer.from(bytes)) ? 'skip' : 'scan';
};

describe('createBundledExportFilePolicy', () => {
  it('only selected installed package subpaths can skip scanning; unknown files never read', async () => {
    const reads: string[] = [], resolutions: string[] = [];
    const bytes = Buffer.from('opaque-content');
    const policy = createBundledExportFilePolicy({
      selection: new Map([['sample', 'pkg-host/sample']]),
      resolve: specifier => { resolutions.push(specifier); return '/installed/sample/plugin.json'; },
      classifyBundledPluginFile: classify,
    }, { readFile: async filename => { reads.push(filename); return bytes; } });
    expect(await policy({ path: 'agent-plugins/sample/package/SKILL.md', bytes })).toBe('skip');
    expect(await policy({ path: 'agent-plugins/sample/package/__tests__/example.ts', bytes })).toBe('skip');
    expect(await policy({ path: 'agent-plugins/sample/package/__tests__/example.ts', bytes: Buffer.from('edited') })).toBe('scan');
    for (const p of ['agent-plugins/custom/package/__tests__/example.ts', 'agent-plugins/sample/memory/notes/a.txt', 'themes/sample/fixtures/a.txt']) {
      expect(await policy({ path: p, bytes })).toBe('scan');
    }
    expect(resolutions).toEqual(['pkg-host/sample/plugin.json']);
    expect(reads).toEqual(['/installed/sample/SKILL.md', '/installed/sample/__tests__/example.ts', '/installed/sample/__tests__/example.ts']);
  });

  it('resolution and read failures retain files for full scanning, resolving once', async () => {
    for (const failResolve of [false, true]) {
      let resolutions = 0;
      const policy = createBundledExportFilePolicy({
        selection: new Map([['sample', 'pkg-host/sample']]),
        resolve: () => { resolutions++; if (failResolve) throw new Error('not installed'); return '/installed/sample/plugin.json'; },
        classifyBundledPluginFile: classify,
      }, { readFile: async () => { throw new Error('missing'); } });
      expect(await policy({ path: 'agent-plugins/sample/package/fixtures/a.txt', bytes: Buffer.from('x') })).toBe('scan');
      expect(await policy({ path: 'agent-plugins/sample/package/fixtures/b.txt', bytes: Buffer.from('x') })).toBe('scan');
      expect(resolutions).toBe(1);
    }
  });

  it('delegates the verdict to the injected classifier with the parsed plugin id and relative path', async () => {
    const seen: unknown[] = [];
    const policy = createBundledExportFilePolicy({
      selection: new Map(), resolve: () => '',
      classifyBundledPluginFile: async ({ pluginId, relativePath }) => { seen.push([pluginId, relativePath]); return 'skip'; },
    });
    expect(await policy({ path: 'agent-plugins/p1/package/a/b.txt', bytes: new Uint8Array() })).toBe('skip');
    expect(seen).toEqual([['p1', 'a/b.txt']]);
  });

  it('an unselected plugin has no installed copy, so nothing skips', async () => {
    const policy = createBundledExportFilePolicy({
      selection: new Map(), resolve: () => { throw new Error('must not resolve'); }, classifyBundledPluginFile: classify,
    });
    expect(await policy({ path: 'agent-plugins/other/package/a.txt', bytes: Buffer.from('x') })).toBe('scan');
  });
});

it('compares actual installed file bytes when no override reader is given', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bundled-file-'));
  try {
    await writeFile(path.join(root, 'README.md'), 'bundled template');
    const policy = createBundledExportFilePolicy({
      selection: new Map([['sample', 'host/sample']]),
      resolve: specifier => {
        if (specifier !== 'host/sample/plugin.json') throw new Error(`Unexpected module ${specifier}`);
        return path.join(root, 'plugin.json');
      },
      classifyBundledPluginFile: classify,
    });
    const pathInArchive = 'agent-plugins/sample/package/README.md';
    expect(await policy({ path: pathInArchive, bytes: Buffer.from('bundled template') })).toBe('skip');
    expect(await policy({ path: pathInArchive, bytes: Buffer.from('local edit') })).toBe('scan');
  } finally { await rm(root, { recursive: true, force: true }); }
});

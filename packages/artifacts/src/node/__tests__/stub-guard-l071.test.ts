import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Dirent } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_ARTIFACT_STUB_GUARD_CONFIG as config } from '../../stub-guard.js';
import { findPriorArtifactSiblings, type ArtifactStubFilesystemPort } from '../stub-guard.js';

function file({ name, isFile = true }: { name: string; isFile?: boolean }, _options = {}): Dirent {
  return { name, parentPath: '/scan', isFile: () => isFile, isDirectory: () => !isFile, isBlockDevice: () => false, isCharacterDevice: () => false, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false };
}

it('keeps scan order, sidecar precedence, and stat failures through the filesystem port', async () => {
  const calls: string[] = [];
  const filesystem: ArtifactStubFilesystemPort = {
    readdir: async ({ path }) => {
      calls.push(`dir:${path}`);
      return [file({ name: 'report.html', isFile: false }), file({ name: 'other.html' }), file({ name: 'report-1.html' }), file({ name: 'report-2.html' }), file({ name: 'report-3.html' }), file({ name: 'report-4.html' })];
    },
    readFile: async ({ path }) => {
      calls.push(`read:${path}`);
      if (path.includes('report-1')) return JSON.stringify({ metadata: { identifier: 'unrelated' } });
      if (path.includes('report-2')) return '{broken';
      if (path.includes('report-3')) return JSON.stringify({ metadata: { identifier: 'report' } });
      throw new Error('unreadable');
    },
    stat: async ({ path }) => {
      calls.push(`stat:${path}`);
      if (path.includes('report-3')) throw new Error('removed');
      return { size: 5000 };
    },
  };
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'report', config }, { filesystem })).toEqual([{ name: 'report-2.html', size: 5000 }, { name: 'report-4.html', size: 5000 }]);
  expect(calls).toEqual(['dir:/scan', 'read:/scan/report-1.html.artifact.json', 'read:/scan/report-2.html.artifact.json', 'stat:/scan/report-2.html', 'read:/scan/report-3.html.artifact.json', 'stat:/scan/report-3.html', 'read:/scan/report-4.html.artifact.json', 'stat:/scan/report-4.html']);
});

it.each(['null', '{}', '{"metadata":{"identifier":""}}', '{"metadata":{"identifier":42}}'])('falls back to filename candidates for sidecar %s', async (raw) => {
  const filesystem: ArtifactStubFilesystemPort = {
    readdir: async () => [file({ name: 'phase-2.html' })],
    readFile: async () => raw,
    stat: async () => ({ size: 9 }),
  };
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'phase', config }, { filesystem })).toEqual([{ name: 'phase-2.html', size: 9 }]);
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'phase-2', config }, { filesystem })).toEqual([{ name: 'phase-2.html', size: 9 }]);
});

it('retains empty-slug lineage matching when the sidecar carries the literal identifier', async () => {
  const filesystem: ArtifactStubFilesystemPort = {
    readdir: async () => [file({ name: 'artifact.html' }), file({ name: 'artifact-2.html' })],
    readFile: async ({ path }) => path.includes('artifact-2') ? '{}' : JSON.stringify({ metadata: { identifier: '测试' } }),
    stat: async () => ({ size: 8 }),
  };
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: '测试', config }, { filesystem })).toEqual([{ name: 'artifact.html', size: 8 }]);
});

it('escapes identifier and extension metacharacters and retains case-sensitive lineage checks', async () => {
  const filesystem: ArtifactStubFilesystemPort = {
    readdir: async () => [file({ name: 'a+b.h+m' }), file({ name: 'aaab.hhhm' }), file({ name: 'A+B.h+m' })],
    readFile: async () => '{}',
    stat: async () => ({ size: 6 }),
  };
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'a+b', config: { siblingExtensions: ['.h+m'] } }, { filesystem })).toEqual([{ name: 'a+b.h+m', size: 6 }]);
});

it('short-circuits empty inputs and recovers from directory failures', async () => {
  const calls: string[] = [];
  const filesystem: ArtifactStubFilesystemPort = {
    readdir: async () => { calls.push('readdir'); throw new Error('unreadable'); },
    readFile: async () => { throw new Error('unexpected read'); },
    stat: async () => { throw new Error('unexpected stat'); },
  };
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: '', config }, { filesystem })).toEqual([]);
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'id', config: { siblingExtensions: [] } }, { filesystem })).toEqual([]);
  expect(calls).toEqual([]);
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'id', config }, { filesystem })).toEqual([]);
  expect(calls).toEqual(['readdir']);
});

it('bounds sidecar reads before JSON interpretation', async () => {
  const reads: number[] = [];
  const filesystem: ArtifactStubFilesystemPort = {
    readdir: async () => [file({ name: 'report.html' })],
    readFile: async ({ maxBytes }) => {
      reads.push(maxBytes);
      return JSON.stringify({ padding: 'x'.repeat(65536), metadata: { identifier: 'different' } });
    },
    stat: async () => ({ size: 5000 }),
  };
  expect(await findPriorArtifactSiblings({ scanDir: '/scan', identifier: 'report', config }, { filesystem }))
    .toEqual([{ name: 'report.html', size: 5000 }]);
  expect(reads).toEqual([65536]);
});

it('native sidecar reads refuse oversized data before trusting its identifier', async () => {
  const scanDir = await mkdtemp(join(tmpdir(), 'jini-sidecar-bound-'));
  try {
    await writeFile(join(scanDir, 'report.html'), 'prior');
    await writeFile(join(scanDir, 'report.html.artifact.json'), JSON.stringify({
      metadata: { identifier: 'different' }, padding: 'x'.repeat(65536),
    }));
    expect(await findPriorArtifactSiblings({ scanDir, identifier: 'report', config }))
      .toEqual([{ name: 'report.html', size: 5 }]);
  } finally { await rm(scanDir, { recursive: true, force: true }); }
});

import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as sourceControl from '../source-control/entry.js';
import * as staticExport from '../static-export/entry.js';
import * as electron from '../packaging/electron/entry.js';
import * as agentJobs from '../agent-jobs/entry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const subpaths = {
  './source-control': 'source-control/entry',
  './static-export': 'static-export/entry',
  './static-export/node': 'static-export/node-adapters',
  './packaging/electron': 'packaging/electron/entry',
  './packaging/electron/typescript': 'packaging/electron/typescript',
  './agent-jobs': 'agent-jobs/entry',
};

test('each extracted subpath has matching declarations, ESM and runtime metadata', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, entry] of Object.entries(subpaths)) {
    expect(manifest.exports[name]).toEqual({ types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js`, default: `./dist/${entry}.js` });
    expect(manifest.jini.entries[name]).toBe('node');
  }
  expect(manifest.peerDependencies.typescript).toBe('^5.6.0');
  expect(manifest.peerDependenciesMeta.typescript).toEqual({ optional: true });
});

test('public entry points expose orchestration and transport adapters', () => {
  expect(typeof sourceControl.commitSiteToSourceControl).toBe('function');
  expect(typeof sourceControl.createSourceControlFetchAdapter).toBe('function');
  expect(typeof staticExport.exportSite).toBe('function');
  expect(typeof staticExport.createExportFetchAdapter).toBe('function');
  expect(typeof electron.stagePackedWorkspace).toBe('function');
  expect(typeof electron.verifyAsarAgainstSource).toBe('function');
  expect(typeof agentJobs.runAgentJobs).toBe('function');
});






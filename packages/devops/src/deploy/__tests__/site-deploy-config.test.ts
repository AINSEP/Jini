import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appendHostDeployNotes, buildDeploymentDescriptor, createDeployConfigKit } from '../site/deploy-config.js';
import type { RenderedDeployConfig } from '../config-contracts.js';

const rendered: RenderedDeployConfig = { filename: 'app.conf', contents: 'x', notes: ['already'] } as RenderedDeployConfig;
const commandLabel = 'acme deploy config';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function tempRoot(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'jini-deploy-config-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const healthCheck = { relPath: 'src/health.ts', pattern: /app\.get\("([^"]+)"/, sourceFile: 'src/health.ts (readiness route)' };
const secrets = [{ name: 'ACME_SECRET', requirement: 'boot-blocking' as const }];

describe('appendHostDeployNotes', () => {
  it('appends only the overlay notes the generator did not print, keyed by the plugin name', () => {
    const reads: string[] = [];
    const readFile = ({ file }: { file: string }) => { reads.push(file); return JSON.stringify({ t: ['already', 'extra'] }); };
    const result = appendHostDeployNotes({ pluginId: 'pub/plug', targetId: 't', rendered, overlaysDir: '/o', commandLabel }, { readFile });
    expect(result.notes).toEqual(['already', 'extra']);
    expect(reads).toEqual([path.join('/o', 'plug', 'deploy-notes.json')]);
  });

  it('returns the rendered config unchanged when there is no overlay, no entry or nothing new', () => {
    expect(appendHostDeployNotes({ pluginId: 'p', targetId: 't', rendered, overlaysDir: '/o', commandLabel }, { readFile: () => undefined })).toBe(rendered);
    expect(appendHostDeployNotes({ pluginId: 'p', targetId: 'constructor', rendered, overlaysDir: '/o', commandLabel }, { readFile: () => '{}' })).toBe(rendered);
    expect(appendHostDeployNotes({ pluginId: 'p', targetId: 't', rendered, overlaysDir: '/o', commandLabel }, { readFile: () => '{"t":["already"]}' })).toBe(rendered);
  });

  it('names the command and the malformed overlay file', () => {
    for (const raw of ['[]', 'null', '{"t":"note"}', '{"t":[1]}']) {
      expect(() => appendHostDeployNotes({ pluginId: 'p', targetId: 't', rendered, overlaysDir: '/o', commandLabel }, { readFile: () => raw }))
        .toThrow(`acme deploy config: ${path.join('/o', 'p', 'deploy-notes.json')} must map each target id to an array of note strings (target "t")`);
    }
  });

  it('reads the overlay from disk by default, treating a missing file as no notes and rethrowing other faults', () => {
    const root = tempRoot({ 'p/deploy-notes.json': '{"t":["disk"]}' });
    expect(appendHostDeployNotes({ pluginId: 'p', targetId: 't', rendered, overlaysDir: root, commandLabel }).notes).toEqual(['already', 'disk']);
    expect(appendHostDeployNotes({ pluginId: 'missing', targetId: 't', rendered, overlaysDir: root, commandLabel })).toBe(rendered);
    mkdirSync(path.join(root, 'dir', 'deploy-notes.json'), { recursive: true });
    expect(() => appendHostDeployNotes({ pluginId: 'dir', targetId: 't', rendered, overlaysDir: root, commandLabel })).toThrow(/EISDIR/);
  });
});

describe('createDeployConfigKit', () => {
  it('binds the injection guard and validation error to the host error type', () => {
    class HostError extends Error {}
    const kit = createDeployConfigKit({ validationError: ({ message }) => new HostError(message), migrationsNote: 'migrates on boot' });
    expect(kit.migrationsNote).toBe('migrates on boot');
    expect(kit.validationError('bad')).toBeInstanceOf(HostError);
    expect(() => kit.assertNoConfigInjection('name', 'ok-name')).not.toThrow();
    expect(() => kit.assertNoConfigInjection('name', 'a"b')).toThrow(HostError);
  });
});

describe('buildDeploymentDescriptor', () => {
  it('derives every field from the repo root files and the injected readiness source', () => {
    const repoRoot = tempRoot({
      Dockerfile: 'FROM node:24\nVOLUME ["/data/sites"]\nEXPOSE 4321\n',
      'package.json': '{\n  "name": "fixture"\n}\n',
      'src/health.ts': 'app.get("/is-ready", handler);',
    });
    expect(buildDeploymentDescriptor({ repoRoot, commandLabel, healthCheck, secrets })).toEqual({
      appName: 'fixture', port: 4321, dockerfilePath: 'Dockerfile', volumeMountPath: '/data/sites',
      volumeName: 'fixture_sites', healthCheckPath: '/is-ready', secrets,
    });
  });

  it('refuses source format drift with the injected command label instead of guessing', () => {
    const repoRoot = tempRoot({ Dockerfile: 'FROM node:24\n', 'package.json': '{"name":"fixture"}', 'src/health.ts': '' });
    expect(() => buildDeploymentDescriptor({ repoRoot, commandLabel, healthCheck, secrets })).toThrow(
      "acme deploy config: could not derive the container port from Dockerfile (EXPOSE line) — its format changed since deploy-config.ts's extraction pattern was written. Update the pattern in deploy-config.ts to match the new format, or hardcode the value there instead with a comment explaining why it can no longer be derived.",
    );
  });
});

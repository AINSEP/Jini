import path from 'node:path';
import { expect, test } from 'vitest';
import { planStaticPublish, publishOutputDir, readStaticPublishConfig, resolvePublishPlan } from '../adapter-plan.js';
import { publishFixture } from './publish.fixture.js';

test('rejects blank required settings and relays a plugin validation failure', () => {
  const { registry } = publishFixture();
  expect(planStaticPublish({ registry, config: { target: 'host', bucket: '  ' } })).toEqual({ ok: false, message: "'bucket' (non-empty string) is required for target 'host'" });
  expect(planStaticPublish({ registry, config: { target: 'host', bucket: 'bad' } })).toEqual({ ok: false, message: 'Bucket is invalid' });
});

test('an unknown target names the installed choices or explains the empty registry', () => {
  const { registry } = publishFixture();
  expect(planStaticPublish({ registry, config: { target: 'gone' } })).toEqual({ ok: false, message: "publish target 'gone' is not available; choose one of: host" });
  const empty = { ...registry, list: () => [] };
  expect(planStaticPublish({ registry: empty, config: { target: 'gone' } })).toEqual({ ok: false, message: "publish target 'gone' is not available: no publish targets are installed (turn on a hosting plugin under Agent Plugins)" });
});

test('reads only descriptor settings and distinguishes blank query and body values', () => {
  const { target } = publishFixture();
  const raw = { target: 'spoofed', bucket: 'studio', region: '  ', basePath: '/spoofed' };
  expect(readStaticPublishConfig({ target, raw, options: { blankAsAbsent: true } })).toEqual({ ok: true, config: { target: 'host', bucket: 'studio' } });
  expect(readStaticPublishConfig({ target, raw, options: { blankAsAbsent: false } })).toEqual({ ok: true, config: { target: 'host', bucket: 'studio', region: '  ' } });
  expect(readStaticPublishConfig({ target, raw: { ...raw, region: false }, options: { blankAsAbsent: true } })).toEqual({ ok: false, message: "'region' must be a string" });
});

test('scopes registry loading, logs unrelated refusals, and translates a loader failure', async () => {
  const f = publishFixture();
  f.loadDeployTargets.mockResolvedValueOnce({ ...f.registry, refusals: ['unrelated plugin failed'] }).mockRejectedValueOnce(new Error('registry offline'));
  await expect(resolvePublishPlan(f.deps, f.input)).resolves.toEqual({ ok: true, target: f.target, basePath: '/docs' });
  await expect(resolvePublishPlan(f.deps, f.input)).resolves.toEqual({ ok: false, message: 'publish targets could not be loaded: registry offline' });
  expect(f.loadDeployTargets.mock.calls).toEqual([[{ workspaceId: 'workspace-7' }], [{ workspaceId: 'workspace-7' }]]);
  expect(f.warn.mock.calls).toEqual([['[static-publish] unrelated plugin failed']]);
});

test('same-target runs get separate export paths', () => {
  const parent = path.resolve('publish');
  expect(publishOutputDir({ parent, target: 'host', runId: 'one' })).toBe(path.join(parent, 'host', 'one'));
  expect(publishOutputDir({ parent, target: 'host', runId: 'two' })).toBe(path.join(parent, 'host', 'two'));
});

import path from 'node:path';
import { expect, test } from 'vitest';
import { buildDeployFilesForPublish, runExportForPublish } from '../adapter-export.js';
import { adaptInstalledTarget } from '../adapter.js';
import { publishFixture } from './publish.fixture.js';

test('publishes exported bytes with portable paths and only known content types', async () => {
  const { exportSiteBound } = publishFixture();
  const report = await exportSiteBound({ outputDir: '/publish/run' });
  const icon = Buffer.from([0, 51, 255]);
  report.assets.succeeded.push(
    { url: '/icons/logo.png', outputFile: path.join('icons', 'logo.png'), data: icon, contentType: null },
    { url: '/icons/icon.svg', outputFile: path.join('icons', 'icon.svg'), data: Buffer.from('<svg/>') },
  );
  expect(buildDeployFilesForPublish(report)).toEqual([
    { file: 'index.html', data: '<h1>Studio</h1>', contentType: 'text/html' },
    { file: 'icons/logo.png', data: icon },
    { file: 'icons/icon.svg', data: Buffer.from('<svg/>') },
  ]);
});

test('exports without a guessed public URL and tolerates cleanup failure', async () => {
  const f = publishFixture();
  f.rmSync.mockImplementation(() => { throw new Error('directory is held open'); });
  const { resolvePublicUrl: _unused, ...legacyTarget } = f.installed;
  const result = await runExportForPublish({ deps: f.deps, input: f.input, outputDir: '/publish/run', basePath: undefined, target: adaptInstalledTarget(legacyTarget) });
  expect(f.exportSiteBound.mock.calls).toEqual([[{ outputDir: '/publish/run', clean: true }]]);
  expect(f.rmSync.mock.calls).toEqual([['/publish/run', { recursive: true, force: true }]]);
  expect(result).toMatchObject({ ok: true, report: { outputDir: '/publish/run', routes: { succeeded: [{ outputFile: 'index.html', data: '<h1>Studio</h1>' }] } } });
});

test('cleans only the run directory and reports a thrown export failure', async () => {
  const f = publishFixture();
  f.exportSiteBound.mockRejectedValueOnce('render server closed');
  const result = await runExportForPublish({ deps: f.deps, input: f.input, outputDir: '/publish/run', basePath: '/docs', target: adaptInstalledTarget(f.installed) });
  expect(f.rmSync.mock.calls).toEqual([['/publish/run', { recursive: true, force: true }]]);
  expect(result).toEqual({ ok: false, outcome: { ok: false, code: 'EXPORT_FAILED', message: 'export failed before publishing could start: render server closed' } });
});

test('refuses an export with a missing asset even when its HTML rendered', async () => {
  const f = publishFixture();
  const report = await f.exportSiteBound({ outputDir: '/publish/run' });
  report.assets.failed.push({ url: '/theme.css', reason: 'HTTP 404' }, { url: '/logo.svg', reason: 'HTTP 503' });
  f.exportSiteBound.mockResolvedValueOnce(report);
  const result = await runExportForPublish({ deps: f.deps, input: f.input, outputDir: '/publish/run', basePath: '/docs', target: adaptInstalledTarget(f.installed) });
  expect(result).toEqual({ ok: false, outcome: { ok: false, code: 'EXPORT_FAILED', message: "refused to publish: 2 asset(s) failed to export (first: '/theme.css' — HTTP 404). Call deployment_diagnose_static_export for the full list." } });
  expect(f.rmSync.mock.calls).toEqual([['/publish/run', { recursive: true, force: true }]]);
});

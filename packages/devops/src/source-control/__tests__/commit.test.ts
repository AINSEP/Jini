import assert from 'node:assert/strict';
import { test } from 'vitest';
import { commitSiteToSourceControl, previewCommitExport, toCommitFile } from '../commit.js';
import type { CommitOrchestrationArgs, SourceControlCommitResult } from '../contracts.js';
import type { ExportReport } from '../../static-export/contracts.js';

function fixture() {
  const events: string[] = [];
  const report: ExportReport = {
    outputDir: '/artifacts/run-1', routes: { succeeded: [{ path: '/', kind: 'home', outputFile: 'index.html', data: 'é' }], failed: [] },
    assets: { succeeded: [{ url: '/assets/a.bin', outputFile: 'assets/a.bin', data: Buffer.from([0, 128, 255]) }], failed: [] },
    skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [],
  };
  const success: SourceControlCommitResult = { ok: true, branch: 'main', branchCreated: true, commitSha: 'sha', commitUrl: 'https://example.test/commit/sha', filesChanged: 2, filesDeleted: 1 };
  let captured: unknown;
  let id = 0;
  const args: CommitOrchestrationArgs = {
    workspaceId: 'workspace', providerId: 'example', owner: 'team', repo: 'site', commitMessage: 'update',
    credentials: { resolve: async () => { events.push('credential'); return { providerId: 'example', token: 'secret' }; } },
    files: { export: async ({ outputDir }) => { events.push('export:' + outputDir); return report; } },
    layout: { outputDirectory: ({ runId }) => '/artifacts/' + runId, cleanup: async ({ outputDir }) => { events.push('cleanup:' + outputDir); } },
    ids: { next: () => 'run-' + ++id },
    adapter: { commitSite: async input => { events.push('commit'); captured = input; return success; } },
    describeError: () => 'safe failure',
  };
  return { args, events, report, captured: () => captured };
}

test('invalid config and missing/wrong-provider credentials stop before any export', async () => {
  const f = fixture();
  assert.deepEqual(await commitSiteToSourceControl({ ...f.args, owner: 'not valid' }), { ok: false, code: 'INVALID_CONFIG', message: "invalid owner 'not valid'" });
  assert.deepEqual(f.events, []);
  f.args.credentials.resolve = async () => null;
  assert.equal((await commitSiteToSourceControl(f.args)).ok, false);
  f.args.credentials.resolve = async () => ({ providerId: 'other', token: 'secret' });
  const wrong = await commitSiteToSourceControl(f.args);
  assert.equal(wrong.ok, false);
  if (wrong.ok) assert.fail('wrong-provider credential accepted');
  assert.equal(wrong.code, 'NO_CREDENTIALS_CONFIGURED');
  assert.deepEqual(f.events, []);
});

test('successful commit uses a fresh export, exact bytes and cleanup before provider I/O', async () => {
  const f = fixture();
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: true, owner: 'team', repo: 'site', branch: 'main', branchCreated: true, commitSha: 'sha', commitUrl: 'https://example.test/commit/sha', filesChanged: 2, filesDeleted: 1, divergedPaths: [] });
  assert.deepEqual(f.events, ['credential', 'export:/artifacts/run-1', 'cleanup:/artifacts/run-1', 'commit']);
  assert.deepEqual(f.captured(), { token: 'secret', owner: 'team', repo: 'site', commitMessage: 'update', files: [{ path: 'index.html', data: 'é' }, { path: 'assets/a.bin', data: Buffer.from([0,128,255]) }] });
  await commitSiteToSourceControl(f.args);
  assert.equal(f.events.includes('export:/artifacts/run-2'), true);
});

test('both route and asset failures block commits and release the run directory', async () => {
  for (const kind of ['route', 'asset'] as const) {
    const f = fixture();
    if (kind === 'route') f.report.routes.failed.push({ path: '/broken', kind: 'page', reason: 'expected 200, got 500' });
    else f.report.assets.failed.push({ url: '/assets/missing', reason: 'GET -> 404' });
    const result = await commitSiteToSourceControl(f.args);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('failed export committed');
    assert.equal(result.code, 'EXPORT_FAILED');
    assert.match(result.message, new RegExp(`1 ${kind}\\(s\\) failed`));
    assert.equal(f.events.includes('commit'), false);
    assert.equal(f.events.includes('cleanup:/artifacts/run-1'), true);
  }
});

test('preview counts actual bytes, sorts/caps paths and never resolves credentials or commits', async () => {
  const f = fixture();
  assert.deepEqual(await previewCommitExport(f.args), { ok: true, fileCount: 2, totalBytes: 5, paths: ['assets/a.bin', 'index.html'] });
  assert.deepEqual(f.events, ['export:/artifacts/run-1', 'cleanup:/artifacts/run-1']);
  assert.deepEqual(toCommitFile({ outputFile: 'assets\\binary.bin', data: Buffer.from([255]) }), { path: 'assets/binary.bin', data: Buffer.from([255]) });
});

test('preview caps the sorted path summary at 50 without changing counts', async () => {
  const f = fixture();
  f.report.routes.succeeded = Array.from({ length: 60 }, (_, n) => ({ path: '/p' + n, kind: 'page', outputFile: `p${n.toString().padStart(2, '0')}/index.html`, data: 'x' }));
  const result = await previewCommitExport(f.args);
  if (!result.ok) assert.fail(result.message);
  assert.equal(result.fileCount, 61);
  assert.equal(result.totalBytes, 63);
  assert.equal(result.paths.length, 50);
  assert.equal(result.paths[0], 'assets/a.bin');
});

test('port errors become safe outcomes and export failure still cleans up', async () => {
  const f = fixture();
  f.args.files.export = async () => { throw new Error('secret'); };
  const result = await commitSiteToSourceControl(f.args);
  assert.deepEqual(result, { ok: false, code: 'EXPORT_FAILED', message: 'export failed before committing could start: safe failure' });
  assert.deepEqual(f.events, ['credential', 'cleanup:/artifacts/run-1']);
  f.args.credentials.resolve = async () => { throw new Error('secret'); };
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: 'credential could not be resolved: safe failure' });
});

test('every provider failure code is preserved and provider throws are safely mapped', async () => {
  const codes = { 'repository-not-found': 'REPOSITORY_NOT_FOUND', 'no-changes': 'NO_CHANGES', diverged: 'DIVERGED_BRANCH', 'network-unreachable': 'NETWORK_UNREACHABLE', 'provider-error': 'PROVIDER_ERROR' } as const;
  for (const [code, mapped] of Object.entries(codes)) {
    const f = fixture();
    f.args.adapter.commitSite = async () => ({ ok: false, code: code as keyof typeof codes, message: 'refused' });
    assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: mapped, message: 'refused' });
  }
  const f = fixture();
  f.args.adapter.commitSite = async () => { throw new Error('token=secret'); };
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'PROVIDER_ERROR', message: 'safe failure' });
});

// --- Characterization pins (written on the pre-refactor code) ---

test('a missing credential refuses with the provider named and never exports', async () => {
  const f = fixture();
  f.args.credentials.resolve = async () => null;
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: "No source control credential is configured for 'example'." });
  assert.deepEqual(f.events, []);
});

test('a credential for another provider refuses with the expected provider named', async () => {
  const f = fixture();
  f.args.credentials.resolve = async () => ({ providerId: 'other', token: 'secret' });
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'NO_CREDENTIALS_CONFIGURED', message: "The resolved default credential is not a 'example' connection." });
});

test('the credential lookup is scoped to the workspace and provider', async () => {
  const f = fixture();
  let seen: unknown;
  f.args.credentials.resolve = async input => { seen = input; return null; };
  await commitSiteToSourceControl(f.args);
  assert.deepEqual(seen, { workspaceId: 'workspace', providerId: 'example' });
});

test('a host validateTarget refusal stops before credentials are resolved', async () => {
  const f = fixture();
  f.args.credentials.resolve = async () => { f.events.push('credential'); return null; };
  assert.deepEqual(await commitSiteToSourceControl(f.args, { validateTarget: () => 'host refused' }), { ok: false, code: 'INVALID_CONFIG', message: 'host refused' });
  assert.deepEqual(f.events, []);
});

test('an invalid branch refuses as INVALID_CONFIG before credentials are resolved', async () => {
  const f = fixture();
  assert.deepEqual(await commitSiteToSourceControl(f.args, { branch: 'bad branch' }), { ok: false, code: 'INVALID_CONFIG', message: "invalid branch name 'bad branch'" });
  assert.deepEqual(f.events, []);
});

test('the branch option is forwarded to the adapter and omitted when not given', async () => {
  const seen: unknown[] = [];
  const f = fixture();
  f.args.adapter.commitSite = async (_input, optional) => { seen.push(optional); return { ok: true, branch: 'b', branchCreated: false, commitSha: 's', commitUrl: 'u', filesChanged: 0, filesDeleted: 0 }; };
  await commitSiteToSourceControl(f.args, { branch: 'release/1' });
  await commitSiteToSourceControl(f.args);
  assert.deepEqual(seen, [{ branch: 'release/1' }, {}]);
});

test('provider divergedPaths are returned unchanged', async () => {
  const f = fixture();
  f.args.adapter.commitSite = async () => ({ ok: true, branch: 'b', branchCreated: false, commitSha: 's', commitUrl: 'u', filesChanged: 1, filesDeleted: 0, divergedPaths: ['a.html'] });
  const result = await commitSiteToSourceControl(f.args);
  if (!result.ok) assert.fail(result.message);
  assert.deepEqual(result.divergedPaths, ['a.html']);
});

test('a throwing output-directory port fails the export without calling cleanup', async () => {
  const f = fixture();
  f.args.layout.outputDirectory = () => { throw new Error('secret'); };
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'EXPORT_FAILED', message: 'export failed before committing could start: safe failure' });
  assert.deepEqual(f.events, ['credential']);
});

test('a throwing cleanup is ignored and the commit still succeeds', async () => {
  const f = fixture();
  f.args.layout.cleanup = async () => { f.events.push('cleanup'); throw new Error('busy'); };
  const result = await commitSiteToSourceControl(f.args);
  assert.equal(result.ok, true);
  assert.deepEqual(f.events, ['credential', 'export:/artifacts/run-1', 'cleanup', 'commit']);
});

test('the export uses a clean output directory derived from workspace, provider and a fresh run id', async () => {
  const f = fixture();
  const seen: unknown[] = [];
  f.args.layout.outputDirectory = input => { seen.push(input); return '/out'; };
  f.args.files.export = async (required, optional) => { seen.push([required, optional]); return f.report; };
  await previewCommitExport(f.args);
  assert.deepEqual(seen, [{ workspaceId: 'workspace', providerId: 'example', runId: 'run-1' }, [{ outputDir: '/out' }, { clean: true }]]);
});

test('preview refuses invalid config without exporting', async () => {
  const f = fixture();
  assert.deepEqual(await previewCommitExport({ ...f.args, commitMessage: ' ' }), { ok: false, code: 'INVALID_CONFIG', message: 'commitMessage must be 1-500 characters' });
  assert.deepEqual(f.events, []);
});

test('preview reports an export failure with the first failed route', async () => {
  const f = fixture();
  f.report.routes.failed.push({ path: '/broken', kind: 'page', reason: 'expected 200, got 500' }, { path: '/b2', kind: 'page', reason: 'x' });
  assert.deepEqual(await previewCommitExport(f.args), { ok: false, code: 'EXPORT_FAILED', message: "refused to commit: 2 route(s) failed to export (first: '/broken' — expected 200, got 500)" });
});

test('folder previews prefix paths and commits forward the normalized destination once', async () => {
  const f = fixture();
  const args = { ...f.args, folder: 'static_sites\\summer//' };
  const preview = await previewCommitExport(args);
  if (!preview.ok) assert.fail(preview.message);
  assert.deepEqual(preview.paths, ['static_sites/summer/assets/a.bin', 'static_sites/summer/index.html']);
  const result = await commitSiteToSourceControl({ ...args, supportsFolder: true });
  assert.equal(result.ok, true);
  assert.equal((f.captured() as { folder: string }).folder, 'static_sites/summer');
  assert.equal((f.captured() as { files: { path: string }[] }).files[0]!.path, 'index.html');
});

test('unsafe folders and unsupported providers refuse before credentials and export', async () => {
  for (const folder of ['../escape', '/absolute', 'safe']) {
    const f = fixture();
    const result = await commitSiteToSourceControl({ ...f.args, folder });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('unsafe commit accepted');
    assert.equal(result.code, 'INVALID_CONFIG');
    assert.deepEqual(f.events, []);
  }
});

test('unsafe exported file paths fail as export outcomes before the provider sees them', async () => {
  const f = fixture();
  f.report.routes.succeeded[0]!.outputFile = '../escape.html';
  const preview = await previewCommitExport({ ...f.args, folder: 'site' });
  if (preview.ok) assert.fail('unsafe preview accepted');
  assert.equal(preview.code, 'EXPORT_FAILED');
  const commit = await commitSiteToSourceControl({ ...f.args, folder: 'site', supportsFolder: true });
  if (commit.ok) assert.fail('unsafe commit accepted');
  assert.equal(commit.code, 'EXPORT_FAILED');
  assert.equal(f.events.includes('commit'), false);
});

test('a describeError that throws while reporting an export fault propagates and still cleans up', async () => {
  const f = fixture();
  f.args.files.export = async () => { throw new Error('export'); };
  f.args.describeError = () => { throw new Error('describer crashed'); };
  await assert.rejects(commitSiteToSourceControl(f.args), /describer crashed/);
  assert.deepEqual(f.events, ['credential', 'cleanup:/artifacts/run-1']);
});

// --- SC-1 hardening: the five gaps `commitSiteToSourceControl` had against the host's own copy ---

const OPAQUE_TOKEN = 'zq81-opaque-credential-with-no-known-prefix';

test('G1: a provider failure message is redacted with the resolved token and keeps the rest of the text', async () => {
  const f = fixture();
  f.args.credentials.resolve = async () => ({ providerId: 'example', token: OPAQUE_TOKEN });
  f.args.adapter.commitSite = async () => ({ ok: false, code: 'provider-error', message: `x ${OPAQUE_TOKEN} y` });
  const result = await commitSiteToSourceControl(f.args);
  if (result.ok) assert.fail('failure committed');
  assert.equal(result.code, 'PROVIDER_ERROR');
  assert.equal(result.message.includes(OPAQUE_TOKEN), false);
  assert.match(result.message, /^x .+ y$/);
});

test('G1b: a thrown provider error that carries the token is redacted after the host describes it', async () => {
  const f = fixture();
  f.args.credentials.resolve = async () => ({ providerId: 'example', token: OPAQUE_TOKEN });
  f.args.adapter.commitSite = async () => { throw new Error(`request failed for ${OPAQUE_TOKEN}`); };
  f.args.describeError = ({ error }) => (error as Error).message;
  const result = await commitSiteToSourceControl(f.args);
  if (result.ok) assert.fail('failure committed');
  assert.equal(result.code, 'PROVIDER_ERROR');
  assert.equal(result.message.includes(OPAQUE_TOKEN), false);
  assert.match(result.message, /^request failed for .+$/);
});

test('G2: a provider failure code the host does not know, or an inherited member name, maps to PROVIDER_ERROR', async () => {
  for (const code of ['made-up', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const f = fixture();
    f.args.adapter.commitSite = async () => ({ ok: false, code: code as 'provider-error', message: 'refused' });
    assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'PROVIDER_ERROR', message: 'refused' }, code);
  }
});

test('G3: the host is told which stage failed: export, credential and commit each ask describeError once with their own stage', async () => {
  const injections: Record<string, (f: ReturnType<typeof fixture>) => void> = {
    export: f => { f.args.files.export = async () => { throw new Error('boom'); }; },
    credential: f => { f.args.credentials.resolve = async () => { throw new Error('boom'); }; },
    commit: f => { f.args.adapter.commitSite = async () => { throw new Error('boom'); }; },
  };
  for (const [stage, inject] of Object.entries(injections)) {
    const f = fixture();
    const asked: unknown[] = [];
    f.args.describeError = input => { asked.push(input); return 'safe failure'; };
    inject(f);
    await commitSiteToSourceControl(f.args);
    assert.deepEqual(asked.map(input => (input as { stage?: string }).stage), [stage], stage);
  }
});

test('G4 deny: a path the layout arranges outside the destination is still refused before the provider sees it', async () => {
  const f = fixture();
  f.args.layout.arrangeFiles = () => [{ path: '../escape.html', data: 'x' }];
  const result = await commitSiteToSourceControl({ ...f.args, folder: 'site', supportsFolder: true });
  if (result.ok) assert.fail('an escaping arranged path was committed');
  assert.equal(result.code, 'EXPORT_FAILED');
  assert.equal(f.events.includes('commit'), false);
  const preview = await previewCommitExport({ ...f.args, folder: 'site' });
  assert.equal(preview.ok, false);
});

test('G4: arrangeFiles receives the export report and the provider is handed exactly the arranged files, before cleanup', async () => {
  const f = fixture();
  const seen: unknown[] = [];
  const arranged = [{ path: 'landing.html', data: 'hello' }, { path: 'site/index.html', data: Buffer.from([1, 2]) }];
  f.args.layout.arrangeFiles = required => { f.events.push('arrange'); seen.push(required); return arranged; };
  assert.equal((await commitSiteToSourceControl(f.args)).ok, true);
  assert.deepEqual(seen, [{ report: f.report }]);
  assert.deepEqual((f.captured() as { files: unknown }).files, arranged);
  assert.deepEqual(f.events, ['credential', 'export:/artifacts/run-1', 'arrange', 'cleanup:/artifacts/run-1', 'commit']);
});

test('G4: arrangeFiles also shapes the preview', async () => {
  const f = fixture();
  f.args.layout.arrangeFiles = () => [{ path: 'only.html', data: 'abc' }];
  assert.deepEqual(await previewCommitExport(f.args), { ok: true, fileCount: 1, totalBytes: 3, paths: ['only.html'] });
});

test('G4: a throwing arrangement refuses as EXPORT_FAILED worded by the host for the arrange stage, never calls the provider, and still cleans up once', async () => {
  const f = fixture();
  const asked: unknown[] = [];
  f.args.layout.arrangeFiles = () => { f.events.push('arrange'); throw new Error('collision'); };
  f.args.describeError = input => { asked.push(input); return 'packaging failed'; };
  assert.deepEqual(await commitSiteToSourceControl(f.args), { ok: false, code: 'EXPORT_FAILED', message: 'packaging failed' });
  assert.deepEqual(asked, [{ error: new Error('collision'), stage: 'arrange' }]);
  assert.deepEqual(f.events, ['credential', 'export:/artifacts/run-1', 'arrange', 'cleanup:/artifacts/run-1']);
});

import { join } from "node:path";
import type { StaticPublishFormDestinationPort } from "../adapter.js";
import { publishFixture } from "./publish.fixture.js";
import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import { adaptInstalledTarget, publishStaticSite, type StaticPublishDeps, type StaticPublishInput } from '../adapter.js';

test('a credential changed since domain review cannot reach export or publication', async () => {
  let writes = 0;
  const target = { descriptor: { id: 'host', configFields: [] }, module: { validateConfig: () => null, basePath: () => undefined } };
  const deps = { credentialSource: { resolve: async () => ({ ok: true, token: 'new-token', basis: { kind: 'env' } }) },
    loadDeployTargets: async () => ({ get: () => target, refusals: [] }),
    tracker: { trace: async ({ run }: { run(span: { setOutcome(): void }): Promise<unknown> }) => run({ setOutcome() {} }) },
    buildTarget: () => { writes++; throw new Error('unreviewed publication'); },
  } as unknown as StaticPublishDeps;
  const input = { workspaceId: 'ws', projectName: 'Site', config: { target: 'host' },
    domainApproval: { credentialBinding: 'old-binding' }, exportSiteBound: async () => { writes++; },
  } as unknown as StaticPublishInput;
  assert.deepEqual(await publishStaticSite(deps, input), { ok: false, code: 'INVALID_CONFIG', message: 'CREDENTIAL_CHANGED: The connection changed after domain review. Preview and confirm again before publishing.' });
  assert.equal(writes, 0);
});

test('rejects invalid project and provider configuration before touching credentials', async () => {
  const f = publishFixture();
  for (const projectName of ['  ', 'x'.repeat(201)]) {
    expect(await publishStaticSite(f.deps, { ...f.input, projectName })).toEqual({
      ok: false, code: 'INVALID_CONFIG', message: 'projectName must be 1-200 characters',
    });
  }
  expect(await publishStaticSite(f.deps, { ...f.input, config: { target: 'host', bucket: 'bad' } })).toEqual({
    ok: false, code: 'INVALID_CONFIG', message: 'Bucket is invalid',
  });
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.publish).not.toHaveBeenCalled();
});

test('returns credential setup for a refusal, an unreadable connection, or an unusable target', async () => {
  const f = publishFixture();
  const input = { ...f.input, credentialId: 'selection' };
  f.resolve.mockResolvedValueOnce({ ok: false, reason: 'Connection is disabled.' })
    .mockRejectedValueOnce(new Error('vault is locked'));
  f.create.mockImplementationOnce(() => { throw new Error('private configuration'); });
  const setup = { setupToolId: 'credential_save', prefill: { kind: 'publish-host', target: 'host' } };
  for (const message of ['Connection is disabled.', 'credential could not be resolved: vault is locked', 'credential is not usable for host']) {
    expect(await publishStaticSite(f.deps, input)).toEqual({
      ok: false, code: 'NO_CREDENTIALS_CONFIGURED', credentialSetup: setup, message,
    });
  }
  expect(f.resolve.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ workspaceId: 'workspace-7', target: 'host', credentialId: 'selection' }]));
  expect(f.exportSiteBound).not.toHaveBeenCalled();
  expect(f.publish).not.toHaveBeenCalled();
});

test('passes clean export bytes, headers and job progress through the installed host ABI', async () => {
  const f = publishFixture();
  const onProgress = vi.fn();
  const providerProgress = { phase: 'uploading', deploymentCreated: true, deploymentId: 'remote-41' } as const;
  f.publish.mockImplementationOnce(async received => {
    received.onProgress?.(providerProgress);
    return { targetId: 'host', url: f.url, status: 'ready', deploymentId: 'remote-41', providerMetadata: { branch: 'release' } };
  });
  f.resolve.mockResolvedValueOnce({ ok: true, token: 'saved-token', credentialId: 'saved-12', basis: { id: 'saved-12', revision: 8 } });
  const result = await publishStaticSite(f.deps, { ...f.input, onProgress });
  expect(result).toEqual({ ok: true, targetId: 'host', url: f.url, status: 'ready', deploymentId: 'remote-41', basePath: '/docs', providerMetadata: { branch: 'release' }, credentialId: 'saved-12' });
  expect(f.create).toHaveBeenCalledExactlyOnceWith({ credential: { token: 'saved-token' }, config: { target: 'host', bucket: 'studio' }, kit: f.kit });
  expect(f.exportSiteBound).toHaveBeenCalledExactlyOnceWith({ outputDir: join('/publish', 'host', 'run-8'), clean: true, basePath: '/docs', publicUrl: f.url });
  expect(f.publish).toHaveBeenCalledExactlyOnceWith({
    projectName: 'Studio', files: [{ file: 'index.html', data: '<h1>Studio</h1>', contentType: 'text/html' }],
    responseHeaders: { 'X-Content-Type-Options': 'nosniff' }, metadata: { target: 'host', bucket: 'studio' }, onProgress: expect.any(Function),
  });
  expect(onProgress.mock.calls).toEqual([[{ progress: { phase: 'uploading', deploymentCreated: 'unknown' } }], [{ progress: providerProgress }]]);
});

test('distinguishes failed provider jobs from uploads still awaiting reachability', async () => {
  const f = publishFixture();
  f.publish
    .mockResolvedValueOnce({ targetId: 'host', url: f.url, status: 'failed', deploymentId: 'dead-3' })
    .mockResolvedValueOnce({ targetId: 'host', url: f.url, status: 'link-delayed', deploymentId: 'new-6', providerMetadata: { branch: 'docs' } })
    .mockRejectedValueOnce('remote disconnected');
  const run = () => publishStaticSite(f.deps, f.input);
  expect(await run()).toEqual({ ok: false, code: 'PROVIDER_ERROR', message: 'Publishing to host failed. Check the provider dashboard before publishing again. Deployment ID: dead-3.' });
  expect(await run()).toEqual({
    ok: 'partial', targetId: 'host', url: f.url, status: 'link-delayed', deploymentId: 'new-6', basePath: '/docs', providerMetadata: { branch: 'docs' },
    message: 'Published to host, but the public URL is not confirmed reachable yet (status: link-delayed).',
  });
  expect(await run()).toEqual({ ok: false, code: 'PROVIDER_ERROR', message: 'remote disconnected' });
});

test('a refused export never publishes and its explanation cannot disclose a credential', async () => {
  const f = publishFixture();
  f.exportSiteBound.mockRejectedValueOnce(new Error('could not read fixture-token-93481'));
  const result = await publishStaticSite(f.deps, f.input);
  expect(result).toEqual({
    ok: false, code: 'EXPORT_FAILED', message: expect.stringMatching(/^export failed before publishing could start: could not read (?!.*fixture-token-93481).+$/),
  });
  expect(f.publish).not.toHaveBeenCalled();
});

test('prepares the external forms destination, publishes rewritten pages, and saves its key only after delivery', async () => {
  const f = publishFixture();
  const submitUrl = 'https://forms.example.test/receive';
  const save = vi.fn(async () => { throw new Error('key store is read-only'); });
  const prepare = vi.fn<StaticPublishFormDestinationPort['prepare']>().mockResolvedValue({ submitUrl, save });
  const previewInput = vi.fn<StaticPublishFormDestinationPort['previewInput']>();
  const rewritten = [{ file: 'index.html', data: '<form action="https://forms.example.test/receive"></form>', contentType: 'text/html' }];
  const rewriteFormActions = vi.fn(() => rewritten);
  const exportSiteBound: StaticPublishInput['exportSiteBound'] = async options => ({ ...await f.exportSiteBound(options), consentWarning: 'Tag consent is not enabled.' });
  const pluginExportHosts = vi.fn<NonNullable<StaticPublishDeps['pluginExportHosts']>>().mockRejectedValue(new Error('catalog unavailable'));
  const deps = { ...f.deps, formDestination: { prepare, previewInput }, rewriteFormActions, pluginExportHosts };
  const result = await publishStaticSite(deps, { ...f.input, exportSiteBound });
  expect(result).toEqual({ ok: true, targetId: 'host', url: f.url, status: 'ready', basePath: '/docs', consentWarning: 'Tag consent is not enabled.' });
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-7', hostingTargetId: 'host', projectName: 'Studio', kit: f.kit });
  expect(rewriteFormActions).toHaveBeenCalledExactlyOnceWith({ files: [{ file: 'index.html', data: '<h1>Studio</h1>', contentType: 'text/html' }], submitUrl });
  expect(f.publish).toHaveBeenCalledExactlyOnceWith({ projectName: 'Studio', files: rewritten, metadata: { target: 'host', bucket: 'studio' }, responseHeaders: { 'X-Content-Type-Options': 'nosniff' } });
  expect(save).toHaveBeenCalledExactlyOnceWith({ url: f.url });
  expect(save.mock.invocationCallOrder[0]!).toBeGreaterThan(f.publish.mock.invocationCallOrder[0]!);
  expect(f.warn.mock.calls.map(([message]) => message)).toEqual([
    '[static-publish] Could not read plugin export hosts',
    '[static-publish] the form receiver key could not be saved; the next publish will replace it',
  ]);
});

test('does not publish when the forms destination cannot be prepared', async () => {
  const f = publishFixture();
  const prepare = vi.fn<StaticPublishFormDestinationPort['prepare']>().mockRejectedValue('receiver is not configured');
  const previewInput = vi.fn<StaticPublishFormDestinationPort['previewInput']>();
  expect(await publishStaticSite({ ...f.deps, formDestination: { prepare, previewInput } }, f.input)).toEqual({
    ok: false, code: 'EXPORT_FAILED', message: "form submissions could not be prepared: receiver is not configured. Check the site's forms, then publish again.",
  });
  expect(f.publish).not.toHaveBeenCalled();
});

test('adds plugin-declared hosts to report-only CSP and forwards the co-hosted receiver configuration', async () => {
  const f = publishFixture();
  const reportOnlyHeader = 'Content-Security-Policy-Report-Only';
  const initialPolicy = "default-src 'none'; script-src 'self'; connect-src 'self'";
  const hosting = { secret: 'receiver-key', forms: [{ slug: 'contact', fields: [{ name: 'email', required: true }] }] };
  const save = vi.fn<NonNullable<Awaited<ReturnType<StaticPublishFormDestinationPort['prepare']>>['save']>>();
  const prepare = vi.fn<StaticPublishFormDestinationPort['prepare']>().mockResolvedValue({ hosting, save });
  const previewInput = vi.fn<StaticPublishFormDestinationPort['previewInput']>();
  const deps: StaticPublishDeps = {
    ...f.deps, hostKit: f.kit,
    formDestination: { prepare, previewInput },
    publicPageSecurityHeaders: () => ({
      [reportOnlyHeader]: initialPolicy,
      'Content-Security-Policy': initialPolicy,
      'X-Frame-Options': 'DENY',
    }),
    pluginExportHosts: async () => ({ script: ['https://js.example.test'], connect: ['https://api.example.test', 'https://invalid.example.test/path'], frame: [] }),
  };
  f.publish.mockResolvedValueOnce({ targetId: 'host', status: 'failed', url: f.url,
    statusMessage: 'Provider denied this deployment for fixture-token-93481.' });
  const result = await publishStaticSite(deps, f.input);
  expect(f.publish).toHaveBeenCalledExactlyOnceWith({
    projectName: 'Studio', files: [{ file: 'index.html', data: '<h1>Studio</h1>', contentType: 'text/html' }],
    metadata: { target: 'host', bucket: 'studio', formDestination: hosting },
    responseHeaders: {
      [reportOnlyHeader]: "default-src 'none'; script-src 'self' https://js.example.test; connect-src 'self' https://api.example.test",
      'Content-Security-Policy': initialPolicy, 'X-Frame-Options': 'DENY',
    },
  });
  expect(result).toEqual({ ok: false, code: 'PROVIDER_ERROR', message: expect.stringMatching(/^Provider denied this deployment for (?!.*fixture-token-93481).+\.$/) });
  expect(save).not.toHaveBeenCalled();
});

test('adapts a legacy installed target using a positional reachability URL and the original provider receiver', async () => {
  const f = publishFixture();
  const checkReachability = vi.fn(async (_url: string) => ({ reachable: true, statusCode: 204 }));
  const legacy = { ...f.installed, checkReachability,
    async resolvePublicUrl({ projectName }: { projectName: string }) {
      return `https://${this.id}.example.test/${projectName.toLowerCase()}/`;
    },
  };
  const target = adaptInstalledTarget(legacy);
  expect(await target.resolvePublicUrl?.({ projectName: 'Studio' })).toBe('https://host.example.test/studio/');
  expect(await target.checkReachability({ url: 'https://host.example.test/studio/' })).toEqual({ reachable: true, statusCode: 204 });
  expect(checkReachability).toHaveBeenCalledExactlyOnceWith('https://host.example.test/studio/');
});

test('an injected target can publish at the root without creating an installed provider target', async () => {
  const f = publishFixture();
  const { basePath: _basePath, ...rootModule } = f.target.module;
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: rootModule } : undefined });
  const buildTarget = vi.fn<NonNullable<StaticPublishDeps['buildTarget']>>().mockReturnValue({
    id: 'injected-host', publish: async ({ projectName, files }) => ({
      targetId: 'host', status: projectName === 'Studio' && files[0]?.file === 'index.html' ? 'ready' : 'failed', url: f.url,
    }),
    checkReachability: async () => ({ reachable: true }),
  });
  expect(await publishStaticSite({ ...f.deps, buildTarget }, f.input)).toEqual({ ok: true, targetId: 'host', status: 'ready', url: f.url });
  expect(buildTarget).toHaveBeenCalledExactlyOnceWith({ target: 'host', bucket: 'studio' }, { token: 'fixture-token-93481' });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.exportSiteBound).toHaveBeenCalledExactlyOnceWith({ outputDir: join('/publish', 'host', 'run-8'), clean: true });
});

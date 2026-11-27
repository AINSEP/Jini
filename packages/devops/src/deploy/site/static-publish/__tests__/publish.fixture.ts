import { vi } from 'vitest';
import { createPublishJobStore, type DeployPublishResult } from '../../../index.js';
import { firstExportFailure } from '../../../../core/export-failure-summary.js';
import { createDeployHostKit } from '../../deploy-targets/host-kit.js';
import type { DeployTargetRegistry, HostDeployTarget, LoadedDeployTarget } from '../../deploy-targets/types.js';
import type { StaticPublishDeps, StaticPublishInput } from '../adapter.js';
import type { PublishCredentialSource } from '../types.js';
import type { Tracker, TrackerSpan } from '@jini-ai/core/contracts/site/diagnostics-observability';

export function publishFixture() {
  function unexpected(): never { throw new Error('unexpected provider call'); }
  const url = 'https://studio.example.test/docs/';
  const kit = createDeployHostKit({ fetchFn: unexpected, createReachability: unexpected, createSigV4Client: unexpected, now: () => 0, sleep: unexpected });
  const setOutcome = vi.fn();
  const trace: Tracker['trace'] = async <T, Outcome>({ run }: { name: string; run: (span: TrackerSpan<Outcome>) => T | Promise<T> }): Promise<T> => run({ setOutcome });
  const tracker: Tracker = { trace, capture: vi.fn(), error: vi.fn(), metric: vi.fn() };
  const publish = vi.fn<HostDeployTarget['publish']>().mockResolvedValue({ targetId: 'host', url, status: 'ready' } satisfies DeployPublishResult);
  const publicUrl = vi.fn<NonNullable<HostDeployTarget['resolvePublicUrl']>>().mockResolvedValue(url);
  const installed: HostDeployTarget = { id: 'host', publish, resolvePublicUrl: publicUrl, checkReachability: unexpected };
  const create = vi.fn<LoadedDeployTarget['module']['create']>().mockReturnValue(installed);
  const target: LoadedDeployTarget = {
    pluginId: 'studio-plugin',
    descriptor: { id: 'host', label: 'Studio host', module: 'studio.mjs', configFields: [
      { name: 'bucket', label: 'Bucket', required: true }, { name: 'region', label: 'Region', required: false },
    ] },
    module: { create, validateConfig: config => config.bucket === 'bad' ? 'Bucket is invalid' : null, basePath: () => '/docs' },
  };
  const registry: DeployTargetRegistry = { get: id => id === 'host' ? target : undefined, list: () => [target], refusals: [] };
  const loadDeployTargets = vi.fn<StaticPublishDeps['loadDeployTargets']>().mockResolvedValue(registry);
  const resolve = vi.fn<PublishCredentialSource['resolve']>().mockResolvedValue({ ok: true, token: 'fixture-token-93481', basis: { kind: 'env' } });
  const isConfigured = vi.fn<PublishCredentialSource['isConfigured']>().mockResolvedValue({ configured: true, basis: { kind: 'env' } });
  const rmSync = vi.fn<StaticPublishDeps['rmSync']>();
  const warn = vi.fn();
  const issueCredentialSetup = vi.fn<StaticPublishDeps['issueCredentialSetup']>(required => required);
  const deps: StaticPublishDeps = {
    publishJobs: createPublishJobStore({}), loadDeployTargets, credentialSource: { resolve, isConfigured }, rmSync, warn, issueCredentialSetup,
    createNoopTracker: () => tracker, createDeployHostKit: () => kit,
    redactSecretShapes: ({ text }) => ({ text }), firstExportFailure: report => firstExportFailure({ report }),
    defaultPublicPageSecurityHeaders: () => ({ 'X-Content-Type-Options': 'nosniff' }), rewriteFormActions: unexpected,
  };
  const exportSiteBound = vi.fn<StaticPublishInput['exportSiteBound']>(async ({ outputDir }) => ({
    outputDir, routes: { succeeded: [{ path: '/', kind: 'page', outputFile: 'index.html', data: '<h1>Studio</h1>', contentType: 'text/html' }], failed: [] },
    assets: { succeeded: [], failed: [] }, skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [],
  }));
  const input: StaticPublishInput = { workspaceId: 'workspace-7', publishOutputRootDir: '/publish', idGen: { newId: () => 'run-8' }, exportSiteBound, config: { target: 'host', bucket: 'studio' }, projectName: 'Studio' };
  return { deps, input, registry, target, kit, create, publish, installed, publicUrl, loadDeployTargets, resolve, isConfigured, rmSync, warn, issueCredentialSetup, exportSiteBound, tracker, setOutcome, url };
}

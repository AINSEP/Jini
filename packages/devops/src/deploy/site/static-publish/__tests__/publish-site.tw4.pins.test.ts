import { expect, it, vi } from 'vitest';
import { describePublishTargets, publishPreviewFor } from '../admin-publish-read.js';
import { missingRequiredFieldMessage, planStaticPublish, readStaticPublishConfig, unknownTargetMessage } from "../adapter-plan.js";
import { publishFixture } from "./publish.fixture.js";
import { createDbPublishCredentialSource } from "../credentials.js";
import { credentialFixture } from "./credential.fixture.js";

it('does not inspect a target when planning or credential readiness fails', async () => {
  for (const [valid, configured] of [[false, true], [true, false]]) {
    const inspectStaticPublish = vi.fn(async () => ({}));
    const registry = { refusals: [], get: () => ({}) } as unknown as Parameters<typeof describePublishTargets>[0]['registry'];
    const read = publishPreviewFor({ context: { credentialSource: {
      isConfigured: async () => configured ? { configured: true as const, basis: { kind: "env" as const } } : { configured: false as const, reason: 'not configured' },
      resolve: async () => { throw new Error('unexpected secret read'); },
    }, deps: {
      workspaceId: 'w', loadDeployTargets: async () => registry, refusal: () => {},
      unknownTargetMessage: () => 'unknown', readStaticPublishConfig: () => ({ ok: true, config: { target: 'target' } }),
      missingRequiredFieldMessage: () => null,
      planStaticPublish: () => valid ? { ok: true } : { ok: false, message: 'invalid' }, inspectStaticPublish,
    } } });
    const result = await read({ query: { target: 'target' } });
    expect(result.ok && result.value.valid).toBe(valid);
    expect(result.ok && result.value.credentialsConfigured).toBe(configured);
    expect(inspectStaticPublish).not.toHaveBeenCalled();
  }
});

it('projects only the public target descriptor fields', () => {
  const registry = {
    list: () => [{ descriptor: { id: 'target', label: 'Target', configFields: [], modulePath: '/private/module', credential: { tokenField: 'token', fields: [], vendorId: 'private-vendor', vendorLabel: 'Vendor' } } }],
    get: () => ({ module: { defaultForNewDestination: true } }),
  } as unknown as Parameters<typeof describePublishTargets>[0]['registry'];
  expect(describePublishTargets({ registry })).toEqual([{ id: 'target', label: 'Target', defaultForNewDestination: true, authenticatedPreview: false, configFields: [], credential: { vendorLabel: 'Vendor', tokenField: 'token', fields: [] } }]);
});

it('passes the explicit connection and project to authenticated admin preview', async () => {
  const f = publishFixture();
  const inspection = { resourceName: 'studio-bucket', targetId: 'host', hostingChanges: [] };
  const inspectStaticPublish = vi.fn(async () => ({ inspection }));
  const read = publishPreviewFor({ context: { credentialSource: f.deps.credentialSource, deps: {
    workspaceId: f.input.workspaceId, loadDeployTargets: f.loadDeployTargets, refusal: f.warn,
    unknownTargetMessage, readStaticPublishConfig, missingRequiredFieldMessage, planStaticPublish, inspectStaticPublish,
  } } });
  expect(await read({ query: { target: 'host', bucket: 'studio', projectName: 'Studio', credentialId: 'choice-9' } })).toEqual({
    ok: true, value: { target: 'host', valid: true, validationError: null, basePath: '/docs', credentialsConfigured: true, credentialGuidance: null, providerInspection: inspection },
  });
  expect(inspectStaticPublish).toHaveBeenCalledExactlyOnceWith({ input: {
    workspaceId: 'workspace-7', config: { target: 'host', bucket: 'studio' }, projectName: 'Studio', credentialId: 'choice-9',
  } });
  expect(f.resolve).not.toHaveBeenCalled();
  await expect(read({ query: { target: 'host', bucket: 'studio', credentialId: '  ' } })).rejects.toThrow(
    'credentialId must be a non-empty string naming the selected connection. Reload and choose it again.',
  );
  expect(inspectStaticPublish).toHaveBeenCalledTimes(1);
});

it('recognizes a selected saved connection when the target has no implicit default', async () => {
  const f = credentialFixture();
  f.hasDefaultForPublish.mockImplementation(async (_deps, input) =>
    input.workspaceId === 'workspace-7' && input.providerId === 'host' && input.id === 'selected'
      ? { id: 'selected', revision: 5 } : null);
  const providerInspection = { resourceName: 'studio', targetId: 'host', hostingChanges: [] };
  const inspectStaticPublish = vi.fn(async () => ({ inspection: providerInspection }));
  const read = publishPreviewFor({ context: {
    credentialSource: createDbPublishCredentialSource(f.dbDeps),
    deps: { workspaceId: 'workspace-7', loadDeployTargets: f.loadDeployTargets, refusal: f.warn,
      unknownTargetMessage, readStaticPublishConfig, missingRequiredFieldMessage, planStaticPublish, inspectStaticPublish },
  } });
  expect(await read({ query: { target: 'host', bucket: 'studio', projectName: 'Studio', credentialId: 'selected' } })).toEqual({
    ok: true, value: { target: 'host', valid: true, validationError: null, basePath: '/docs', credentialsConfigured: true, credentialGuidance: null, providerInspection },
  });
  expect(inspectStaticPublish).toHaveBeenCalledExactlyOnceWith({
    input: { workspaceId: 'workspace-7', config: { target: 'host', bucket: 'studio' }, projectName: 'Studio', credentialId: 'selected' },
  });
});

it('separates malformed preview queries from present but invalid provider settings', async () => {
  const f = publishFixture();
  const inspectStaticPublish = vi.fn(async () => ({}));
  const read = publishPreviewFor({ context: { credentialSource: f.deps.credentialSource, deps: {
    workspaceId: f.input.workspaceId, loadDeployTargets: f.loadDeployTargets, refusal: f.warn,
    unknownTargetMessage, readStaticPublishConfig, missingRequiredFieldMessage, planStaticPublish, inspectStaticPublish,
  } } });
  expect(await read({ query: { target: ' ' } })).toEqual({ ok: false, error: "'target' query param (non-empty string) is required" });
  expect(await read({ query: { target: 'gone' } })).toEqual({ ok: false, error: "publish target 'gone' is not available; choose one of: host" });
  expect(await read({ query: { target: 'host', bucket: 9 } })).toEqual({ ok: false, error: "'bucket' must be a string" });
  expect(await read({ query: { target: 'host', bucket: '  ' } })).toEqual({ ok: false, error: "'bucket' (non-empty string) is required for target 'host'" });
  expect(await read({ query: { target: 'host', bucket: 'bad' } })).toEqual({ ok: true, value: {
    target: 'host', valid: false, validationError: 'Bucket is invalid', basePath: null, credentialsConfigured: true, credentialGuidance: null, providerInspection: undefined,
  } });
  expect(inspectStaticPublish).not.toHaveBeenCalled();
  const { basePath: _basePath, ...rootModule } = f.target.module;
  f.loadDeployTargets.mockResolvedValueOnce({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: rootModule } : undefined });
  expect(await read({ query: { target: 'host', bucket: 'studio' } })).toEqual({ ok: true, value: {
    target: 'host', valid: true, validationError: null, basePath: null, credentialsConfigured: true, credentialGuidance: null, providerInspection: undefined,
  } });
  expect(inspectStaticPublish).toHaveBeenCalledExactlyOnceWith({ input: {
    workspaceId: 'workspace-7', config: { target: 'host', bucket: 'studio' }, projectName: '',
  } });
});

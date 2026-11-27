import { createHash } from 'node:crypto';
import { ToolInputError } from '@jini-ai/core';
import { expect, it, vi } from 'vitest';
import type { StaticPublishFormDestinationPort } from '../adapter.js';
import { inspectStaticPublish } from '../inspection.js';
import { publishFixture } from './publish.fixture.js';

it('inspects the chosen credential with the forms preview port and returns only the public inspection and binding', async () => {
  const f = publishFixture();
  const inspection = { resourceName: 'studio-bucket', targetId: 'host', hostingChanges: [{ action: 'keep' }] };
  const preview = vi.fn(async () => inspection);
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, preview } } : undefined });
  f.resolve.mockResolvedValue({ ok: true, token: 'studio-token', account: 'media', credentialId: 'chosen-4', basis: { id: 'chosen-4', revision: 2 } });
  const hosting = { forms: [] };
  const previewInput = vi.fn<StaticPublishFormDestinationPort['previewInput']>().mockResolvedValue({ hosting });
  const prepare = vi.fn<StaticPublishFormDestinationPort['prepare']>();
  const deps = { ...f.deps, hostKit: f.kit, formDestination: { previewInput, prepare } };
  const result = await inspectStaticPublish({ deps, input: { ...f.input, credentialId: 'chosen-4' } });
  expect(result).toEqual({
    inspection, credentialId: 'chosen-4',
    credentialBinding: createHash('sha256').update('{"token":"studio-token","account":"media"}').digest('hex'),
  });
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-7', target: 'host', credentialId: 'chosen-4' });
  expect(previewInput).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-7', hostingTargetId: 'host', projectName: 'Studio', kit: f.kit });
  expect(preview).toHaveBeenCalledExactlyOnceWith({
    credential: { token: 'studio-token', account: 'media' }, config: { target: 'host', bucket: 'studio' }, kit: f.kit, projectName: 'Studio', formDestination: hosting,
  });
  expect(prepare).not.toHaveBeenCalled();
});

it('checks the target and project before opening any credential', async () => {
  const f = publishFixture();
  const input = f.input;
  await expect(inspectStaticPublish({ deps: f.deps, input: { ...input, config: { target: 'host' } } }))
    .rejects.toThrow("'bucket' (non-empty string) is required for target 'host'");
  expect(await inspectStaticPublish({ deps: f.deps, input })).toEqual({});
  const preview = vi.fn(async () => ({ targetId: 'host', resourceName: 'studio', hostingChanges: [] }));
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, preview } } : undefined });
  expect(await inspectStaticPublish({ deps: f.deps, input: { ...input, projectName: ' ' } })).toEqual({});
  await expect(inspectStaticPublish({ deps: f.deps, input: { ...input, projectName: ' ', config: { ...input.config, customDomain: 'studio.example.test' } } }))
    .rejects.toThrow('PROJECT_NAME_REQUIRED: A custom-domain preview needs projectName.');
  expect(f.resolve).not.toHaveBeenCalled();
  expect(preview).not.toHaveBeenCalled();
});

it('distinguishes unavailable from unreadable credentials without leaking the loader error', async () => {
  const f = publishFixture();
  const preview = vi.fn(async () => ({ targetId: 'host', resourceName: 'studio', hostingChanges: [] }));
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, preview } } : undefined });
  f.resolve.mockResolvedValueOnce({ ok: false, reason: 'Choose a workspace connection.' }).mockRejectedValueOnce(new Error('private vault details'));
  const inspect = () => inspectStaticPublish({ deps: f.deps, input: f.input });
  await expect(inspect()).rejects.toThrow('NO_CREDENTIALS_CONFIGURED: Choose a workspace connection.');
  await expect(inspect()).rejects.toMatchObject({ constructor: ToolInputError, message: 'CREDENTIAL_RESOLUTION_FAILED: The saved connection could not be opened. Reopen the secure connection form and select or repair it before previewing again.' });
  expect(preview).not.toHaveBeenCalled();
});

it('redacts the provider error while retaining its actionable explanation', async () => {
  const f = publishFixture();
  const preview = vi.fn()
    .mockRejectedValueOnce(new Error('Access refused for fixture-token-93481.'))
    .mockRejectedValueOnce('unsafe non-Error from provider');
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, preview } } : undefined });
  const inspect = () => inspectStaticPublish({ deps: f.deps, input: f.input });
  await expect(inspect()).rejects.toMatchObject({ constructor: ToolInputError, message: expect.stringMatching(/^Access refused for (?!.*fixture-token-93481).+\.$/) });
  await expect(inspect()).rejects.toThrow('Provider inspection failed. Check the connection and preview again.');
});

it('returns the external receiver form verdict without sending form definitions to the hosting plugin', async () => {
  const f = publishFixture();
  const inspection = { targetId: 'host', resourceName: 'studio', hostingChanges: [{ action: 'keep' }] };
  const preview = vi.fn(async () => inspection);
  f.loadDeployTargets.mockResolvedValue({ ...f.registry, get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, preview } } : undefined });
  const formSubmissions = { status: 'on', forms: 2, message: 'Forms submit to the external receiver.', changes: [] } as const;
  const formDestination = {
    previewInput: vi.fn<StaticPublishFormDestinationPort['previewInput']>().mockResolvedValue({ formSubmissions }),
    prepare: vi.fn<StaticPublishFormDestinationPort['prepare']>(),
  };
  expect(await inspectStaticPublish({ deps: { ...f.deps, formDestination }, input: f.input })).toEqual({
    inspection: { ...inspection, formSubmissions },
    credentialBinding: createHash('sha256').update('{"token":"fixture-token-93481"}').digest('hex'),
  });
  expect(preview).toHaveBeenCalledExactlyOnceWith({
    projectName: 'Studio', config: { target: 'host', bucket: 'studio' }, kit: f.kit, credential: { token: 'fixture-token-93481' },
  });
  expect(formDestination.prepare).not.toHaveBeenCalled();
});

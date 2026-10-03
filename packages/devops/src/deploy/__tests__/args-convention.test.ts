import { createNodeReachabilityPorts } from '../node.js';
import { describe, expect, it, vi } from 'vitest';
import {
  DeployError, assertNotRedirected, checkDeploymentUrl,
  createDeployPublishToolRegistration, createRoleGatedDeployPublishPolicy,
  normalizeDeploymentUrl, publishDeploy, redirectGuardInit, safeDnsLabel,
  safeProjectLabel, waitForReachableDeploymentUrl, type DeployTarget, type ReachabilityFetchPort,
} from '../index.js';

const { guard } = createNodeReachabilityPorts({});

describe('deploy required arguments and optional arguments', () => {
  it('preserves label, URL, redirect and error behavior through object arguments', () => {
    expect(safeProjectLabel({ raw: 'My Site!', maxLength: 6 })).toBe('my-sit');
    expect(safeDnsLabel({ raw: 'My Site!' })).toBe('my-site');
    expect(normalizeDeploymentUrl({ url: 'site.example' })).toBe('https://site.example');
    const init = { method: 'GET' };
    expect(redirectGuardInit({ init })).toEqual({ method: 'GET', redirect: 'manual' });
    expect(init).toEqual({ method: 'GET' });
    expect(() => assertNotRedirected({ resp: new Response('', { status: 302 }), providerLabel: 'Host' }))
      .toThrow(DeployError);
    const error = new DeployError({ message: 'failed' }, { status: 503, details: { retry: true }, code: 'offline' });
    expect(error).toMatchObject({ message: 'failed', name: 'DeployError', status: 503, details: { retry: true }, code: 'offline' });
    expect(new DeployError({ message: 'invalid' }).status).toBe(400);
  });

  it('passes publish options to the selected target separately from required inputs', async () => {
    const publish = vi.fn<DeployTarget['publish']>().mockResolvedValue({ targetId: 'host', url: 'https://site.example', status: 'ready' });
    const target: DeployTarget = { id: 'host', publish, checkReachability: async () => ({ reachable: true }) };
    const metadata = { region: 'west' };
    await publishDeploy({ targetId: 'host', targets: [target], files: [], projectName: 'site' }, { metadata });
    expect(publish).toHaveBeenCalledWith({ files: [], projectName: 'site' }, { metadata });
    expect(createDeployPublishToolRegistration({ targets: [target] }).policy.authorize({
      principal: { id: 'user' }, run: { id: 'run' }, tool: { id: 'deploy.publish' }, input: {},
    })).toBe('deny');
    const policy = createRoleGatedDeployPublishPolicy({}, { allowedRoles: ['ship'] });
    expect(policy.authorize({ principal: { id: 'user', roles: ['ship'] }, run: { id: 'run' }, tool: { id: 'deploy.publish' }, input: {} })).toBe('allow');
  });

  it('uses the supplied fetch and rejects unsafe URLs before invoking it', async () => {
    const fetchPort = vi.fn<ReachabilityFetchPort>().mockResolvedValue(new Response('', { status: 200 }));
    expect(await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard })).toEqual({ reachable: true, statusCode: 200 });
    expect(fetchPort.mock.calls[0]).toMatchObject([{ url: 'https://site.example/' }, { init: { method: 'HEAD', redirect: 'manual' } }]);
    fetchPort.mockClear();
    expect((await checkDeploymentUrl({ url: 'https://127.0.0.1', fetch: fetchPort, guard })).reachable).toBe(false);
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it('polls with the supplied clock and sleep without waiting in real time', async () => {
    let time = 100;
    const fetchPort = vi.fn<ReachabilityFetchPort>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const sleep = vi.fn(async ({ ms }: { ms: number }) => { time += ms; });
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example', 'https://site.example'], fetch: fetchPort, guard, now: () => time, sleep }, { timeoutMs: 20, intervalMs: 5 });
    expect(result).toEqual({ status: 'ready', url: 'https://site.example', statusMessage: 'Public link is ready.', reachableAt: 105 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith({ ms: 5 });
    expect(fetchPort).toHaveBeenCalledTimes(3);
  });
});

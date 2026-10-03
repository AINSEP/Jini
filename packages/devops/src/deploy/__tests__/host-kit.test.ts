import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  assertNotRedirected,
  checkDeploymentUrl,
  DeployError,
  normalizeDeploymentUrl,
  redirectGuardInit,
  safeDnsLabel,
  safeProjectLabel,
  waitForReachableDeploymentUrl,
  type DeployCredentialCheck,
  type DeployHostKit,
  type DeployPublishOptions,
  type DeployTarget,
  type DeployTargetModule,
  type ResponseHeaderSet,
} from '../index.js';

/** A kit built only from devops' own generic exports plus stubs, as a host would inject it. */
function fixtureKit(): DeployHostKit {
  return {
    fetch: async () => new Response('ok'),
    timeouts: { QUICK: 1, DEPLOY: 2, UPLOAD: 3 },
    sleep: async () => undefined,
    checkDeploymentUrl,
    waitForReachableDeploymentUrl,
    normalizeDeploymentUrl,
    safeDnsLabel,
    safeProjectLabel,
    redirectGuardInit,
    assertNotRedirected,
    createSigV4Client: () => ({
      fetch: async () => new Response('ok'),
      sign: async ({ input }) => new Request(input),
    }),
    DeployError,
  };
}

describe('DeployPublishOptions.responseHeaders', () => {
  it('is an optional, read-only header map in the second argument', () => {
    expectTypeOf<DeployPublishOptions['responseHeaders']>().toEqualTypeOf<ResponseHeaderSet | undefined>();
    expectTypeOf<ResponseHeaderSet>().toEqualTypeOf<Readonly<Record<string, string>>>();
  });

  it('reaches a DeployTarget through publish unchanged', async () => {
    let received: DeployPublishOptions['responseHeaders'];
    const target: DeployTarget = {
      id: 'fixture',
      publish: async (_input, options) => {
        received = options?.responseHeaders;
        return { targetId: 'fixture', url: 'https://example.test', status: 'ready' };
      },
      checkReachability: async () => ({ reachable: true }),
    };
    const headers = { 'X-Frame-Options': 'DENY' } as const;
    await target.publish({ files: [], projectName: 'p' }, { responseHeaders: headers });
    expect(received).toBe(headers);
  });
});

describe('DeployTargetModule / DeployHostKit injection contract', () => {
  it('lets a host build a target from a module without devops naming any host', async () => {
    const module: DeployTargetModule = {
      create: ({ credential, config, kit }) => ({
        id: `fixture-${String(config.site)}`,
        publish: async (input) => ({
          targetId: 'fixture',
          url: kit.normalizeDeploymentUrl({ url: `${kit.safeDnsLabel({ raw: input.projectName })}.example.test` }),
          status: 'ready',
          providerMetadata: { tokenLength: credential.token.length },
        }),
        checkReachability: async () => ({ reachable: true }),
      }),
      validateConfig: ({ config }) => (typeof config.site === 'string' ? null : 'site is required'),
      basePath: () => undefined,
      verifyCredential: async ({ credential }) =>
        credential.token ? { ok: true, accountLabel: 'someone' } : { ok: false, reason: 'rejected' },
    };

    const kit = fixtureKit();
    const target = module.create({ credential: { token: 'abc', accountId: 'a1' }, config: { site: 's' }, kit });
    expect(target.id).toBe('fixture-s');
    await expect(target.publish({ files: [], projectName: 'My Site' })).resolves.toMatchObject({
      url: 'https://my-site.example.test',
      providerMetadata: { tokenLength: 3 },
    });
    expect(module.validateConfig?.({ config: {} })).toBe('site is required');
    await expect(module.verifyCredential?.({ credential: { token: '' }, kit })).resolves.toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('only requires create; the rest are optional', () => {
    const minimal: DeployTargetModule = {
      create: () => ({
        id: 'm',
        publish: async () => ({ targetId: 'm', url: 'https://m.test', status: 'ready' }),
        checkReachability: async () => ({ reachable: true }),
      }),
    };
    expect(minimal.validateConfig).toBeUndefined();
    expectTypeOf<DeployCredentialCheck>().toMatchTypeOf<
      { ok: true; accountLabel?: string } | { ok: false; reason: 'rejected' | 'unreachable'; statusCode?: number }
    >();
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import * as core from '../index.js';
import * as gated from '../gated-mutations.js';
import * as errors from '../model-facing-tool-errors.js';
import * as contributions from '../contribution-registry.js';
import * as naming from '../naming.js';

describe('integrated package entry points', () => {
  it('publishes each extraction with matching universal runtime metadata', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    for (const subpath of ['gated-mutations', 'model-facing-tool-errors', 'contribution-registry', 'naming']) {
      expect(manifest.exports[`./${subpath}`]).toEqual({
        types: `./dist/${subpath}.d.ts`, import: `./dist/${subpath}.js`, default: `./dist/${subpath}.js`,
      });
      expect(manifest.jini.entries[`./${subpath}`]).toBe('universal');
    }
    expect(manifest.jini.entries['.']).toBe('universal');
    expect(manifest.jini.entries['./composition']).toBe('universal');
  });

  it('shares class and factory identities between the root and subpaths', () => {
    expect(core.ForbiddenError).toBe(gated.ForbiddenError);
    expect(core.TokenExpiredError).toBe(gated.TokenExpiredError);
    expect(core.reclassifyToolError).toBe(errors.reclassifyToolError);
    expect(core.createContributionRegistry).toBe(contributions.createContributionRegistry);
    expect(core.deriveDuplicateName).toBe(naming.deriveDuplicateName);
    expect(core).not.toHaveProperty('authorizeToolInvocation');
    const denied = new gated.ForbiddenError({ message: 'denied', reasonCode: 'DENIED' });
    expect(core.reclassifyToolError({ err: denied, rules: [core.forbiddenRule({
      domainPrefix: 'EXAMPLE', error: core.ForbiddenError,
    })] })).toBeInstanceOf(core.ToolInputError);
  });
});

describe('remaining object argument contracts', () => {
  it('preserves error messages, causes and marker identities', () => {
    const cause = new Error('upstream');
    for (const ErrorClass of [
      gated.TokenExpiredError, gated.TokenAlreadyRedeemedError, gated.PlanStaleError,
      gated.UnauthenticatedError, gated.WorkspaceMismatchError,
    ]) {
      const error = new ErrorClass({ message: 'failure' }, { cause });
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.message).toBe('failure');
      expect(error.cause).toBe(cause);
    }
    const error = new gated.ForbiddenError({ message: 'denied', reasonCode: 'DENIED' }, { cause });
    expect(error.reasonCode).toBe('DENIED');
    expect(error.cause).toBe(cause);
  });

  it('enumerates and clears only the selected contribution instance', () => {
    const keyOf = ({ contribution }: { contribution: { id: string } }) => contribution.id;
    const first = contributions.createContributionRegistry({ keyOf });
    const second = contributions.createContributionRegistry({ keyOf });
    first.register({ contribution: { id: 'one' } });
    second.register({ contribution: { id: 'two' } });
    first.clear({});
    expect(first.list({})).toEqual([]);
    expect(second.list({})).toEqual([{ id: 'two' }]);
  });

  it('uses zero-argument clock/ID getters and object arguments for approval operations', async () => {
    const nowMs = vi.fn(() => Date.parse('2026-10-01T00:00:00.000Z'));
    const newId = vi.fn(() => 'plan-id');
    const generateToken = vi.fn((_required: Record<string, never>) => 'opaque-token');
    const computePlan = vi.fn(async (_required: Record<string, never>) => ({ planHash: 'hash', details: { approved: true } }));
    const executeMutation = vi.fn(async (verified: { planHash: string; details: unknown }) => verified);
    const hooks: gated.GatedMutationHooks<unknown, unknown> = {
      domain: 'example', readPermission: 'read', mutatePermission: 'write', scopeId: 'scope',
      computePlan, executeMutation, resolveActorClassIdentity: async ({ principalId }) => principalId,
    };
    const tokens = new gated.InMemoryTokenStore({});
    const deps: gated.GatewayDeps = {
      clock: { nowMs }, idGen: { newId }, generateToken, ttlSeconds: 600, tokens,
      authorize: async () => ({ allowed: true, reason: 'granted' }),
    };
    const required = { deps, hooks, principalId: 'user', principalKind: 'user' as const };
    const preview = await gated.plan(required);
    expect(await tokens.count({})).toBe(0);
    const token = await gated.confirm({ ...required, planId: preview.planId, planHash: preview.planHash });
    expect(await gated.execute({ ...required, confirmationToken: token.confirmationToken })).toEqual({
      planHash: 'hash', details: { approved: true },
    });
    for (const callback of [generateToken, computePlan]) {
      expect(callback).toHaveBeenCalledWith({});
      expect(callback.mock.calls.every(args => args.length === 1)).toBe(true);
    }
    expect(token.createdAt).toBe('2026-10-01T00:00:00.000Z');
    for (const getter of [nowMs, newId]) {
      expect(getter).toHaveBeenCalledWith();
      expect(getter.mock.calls.every(args => args.length === 0)).toBe(true);
    }
    expect(executeMutation).toHaveBeenCalledTimes(1);
    await expect(gated.execute({ ...required, confirmationToken: token.confirmationToken }))
      .rejects.toBeInstanceOf(gated.TokenAlreadyRedeemedError);
    expect(executeMutation).toHaveBeenCalledTimes(1);
  });

  it('gives an exhaustion port the actual bounded search context', async () => {
    const error = new Error('exhausted');
    const onExhausted = vi.fn((_required: { base: string; maxAttempts: number }): never => { throw error; });
    await expect(naming.deriveAvailableName({
      base: 'name', isTaken: async () => true,
      withSuffix: ({ base, suffix }) => `${base} ${suffix}`,
      exhaustionMessage: () => 'fallback',
    }, { maxAttempts: 2, onExhausted })).rejects.toBe(error);
    expect(onExhausted).toHaveBeenCalledWith({ base: 'name', maxAttempts: 2 });
  });
});

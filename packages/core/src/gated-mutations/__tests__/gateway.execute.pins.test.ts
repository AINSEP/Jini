import { describe, expect, it } from 'vitest';

import { ForbiddenError, PlanStaleError, execute, plan, confirm, type GatedMutationHooks, type GatewayDeps } from '../gateway.js';
import { TokenAlreadyRedeemedError, TokenExpiredError, type ConfirmationTokenRecord, type TokenStorePort } from '../token.js';
import type { AuthorizeFn } from '../ports.js';

// Characterization pins: one test per rejection branch of execute(), with exact messages, plus
// the shared authorization refusal text used by plan() and confirm().
const NOW = '2026-07-15T00:00:00.000Z';
const HASH = 'sha256:' + 'a'.repeat(64);
const TOKEN = 'confirmation-token';

function record(overrides: Partial<ConfirmationTokenRecord> = {}): ConfirmationTokenRecord {
  return {
    confirmationToken: TOKEN, planHash: HASH, scopeId: 'ws-1', confirmerPrincipalId: 'u-1',
    status: 'minted', createdAt: NOW, expiresAt: '2026-07-15T00:10:00.000Z', ...overrides,
  };
}

interface StoreCalls { find: number; redeem: number }

function fakeStore(
  found: ConfirmationTokenRecord | null,
  redeemResult: { redeemed: boolean; record: ConfirmationTokenRecord | null } = { redeemed: true, record: record({ status: 'redeemed' }) },
): TokenStorePort & { calls: StoreCalls } {
  const calls: StoreCalls = { find: 0, redeem: 0 };
  return {
    calls,
    async save() {},
    async findByToken() { calls.find += 1; return found; },
    async tryRedeem() { calls.redeem += 1; return redeemResult; },
    async expire() {},
  };
}

function deps(tokens: TokenStorePort, authorize: AuthorizeFn = async () => ({ allowed: true, reason: 'ok' }), nowMs = Date.parse(NOW)): GatewayDeps {
  return {
    generateToken: () => TOKEN, ttlSeconds: 600, clock: { nowMs: () => nowMs },
    idGen: { newId: () => 'plan-1' }, authorize, tokens,
  };
}

interface HookState { mutations: Array<{ planHash: string; details: unknown }> }

function hooks(overrides: Partial<GatedMutationHooks<unknown, string>> = {}): GatedMutationHooks<unknown, string> & HookState {
  const mutations: HookState['mutations'] = [];
  return {
    mutations,
    domain: 'db.migrate', readPermission: 'db.read', mutatePermission: 'db.migrate', scopeId: 'ws-1',
    async computePlan() { return { planHash: HASH, details: { steps: 2 } }; },
    async executeMutation(verified) { mutations.push(verified); return 'done'; },
    async resolveActorClassIdentity({ principalId }) { return principalId; },
    ...overrides,
  };
}

const run = (d: GatewayDeps, h: GatedMutationHooks<unknown, string>) =>
  execute({ deps: d, principalId: 'u-1', principalKind: 'user', hooks: h, confirmationToken: TOKEN });

describe('execute() rejection pins', () => {
  it('refuses an unauthorized caller with NOT_AUTHORIZED before reading the token', async () => {
    const store = fakeStore(record());
    const error = await run(deps(store, async () => ({ allowed: false, reason: 'no_grant' })), hooks()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ reasonCode: 'NOT_AUTHORIZED', message: "principal 'u-1' is not authorized for 'db.migrate' (no_grant)" });
    expect(store.calls.find).toBe(0);
  });

  it('reports an unknown token as not found', async () => {
    await expect(run(deps(fakeStore(null)), hooks())).rejects.toThrow(new TokenExpiredError({ message: 'confirmation token was not found' }));
  });

  it('reports a token already in the redeemed state', async () => {
    await expect(run(deps(fakeStore(record({ status: 'redeemed' }))), hooks()))
      .rejects.toThrow(new TokenAlreadyRedeemedError({ message: 'confirmation token has already been redeemed' }));
  });

  it('reports a minted token past its expiry as expired before redemption', async () => {
    const store = fakeStore(record());
    const h = hooks();
    await expect(run(deps(store, undefined, Date.parse('2026-07-15T00:10:00.001Z')), h))
      .rejects.toThrow(new TokenExpiredError({ message: 'confirmation token has expired' }));
    expect(store.calls.redeem).toBe(0);
  });

  it('reports a token in the expired state as expired', async () => {
    await expect(run(deps(fakeStore(record({ status: 'expired' }))), hooks()))
      .rejects.toThrow(new TokenExpiredError({ message: 'confirmation token has expired' }));
  });

  it('accepts a token exactly at its inclusive expiry instant', async () => {
    await expect(run(deps(fakeStore(record()), undefined, Date.parse('2026-07-15T00:10:00.000Z')), hooks())).resolves.toBe('done');
  });

  it('refuses a caller whose fresh identity is not the confirmer with ACTOR_CLASS_MISMATCH', async () => {
    const error = await run(deps(fakeStore(record({ confirmerPrincipalId: 'u-2' }))), hooks()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ reasonCode: 'ACTOR_CLASS_MISMATCH', message: "principal 'u-1' (kind 'user') is not the confirmer of this token" });
  });

  it('refuses when the identity resolver returns null', async () => {
    await expect(run(deps(fakeStore(record())), hooks({ async resolveActorClassIdentity() { return null; } })))
      .rejects.toMatchObject({ reasonCode: 'ACTOR_CLASS_MISMATCH' });
  });

  it('refuses a token minted for another scope with SCOPE_MISMATCH', async () => {
    const error = await run(deps(fakeStore(record({ scopeId: 'ws-2' }))), hooks()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ reasonCode: 'SCOPE_MISMATCH', message: 'confirmation token belongs to a different scope' });
  });

  it('refuses a stale plan without redeeming the token', async () => {
    const store = fakeStore(record({ planHash: 'sha256:' + 'b'.repeat(64) }));
    await expect(run(deps(store), hooks())).rejects.toThrow(new PlanStaleError({
      message: 'the plan backing this confirmation has changed since it was confirmed; re-plan and re-confirm',
    }));
    expect(store.calls.redeem).toBe(0);
  });

  it('reports a lost redemption with no record as expired', async () => {
    const h = hooks();
    await expect(run(deps(fakeStore(record(), { redeemed: false, record: null })), h))
      .rejects.toThrow(new TokenExpiredError({ message: 'confirmation token has expired' }));
    expect(h.mutations).toEqual([]);
  });

  it('reports a lost redemption whose latest record expired as expired', async () => {
    await expect(run(deps(fakeStore(record(), { redeemed: false, record: record({ status: 'expired' }) })), hooks()))
      .rejects.toThrow(new TokenExpiredError({ message: 'confirmation token has expired' }));
  });

  it('reports a lost redemption whose latest record was redeemed as already redeemed', async () => {
    const h = hooks();
    await expect(run(deps(fakeStore(record(), { redeemed: false, record: record({ status: 'redeemed' }) })), h))
      .rejects.toThrow(new TokenAlreadyRedeemedError({ message: 'confirmation token has already been redeemed' }));
    expect(h.mutations).toEqual([]);
  });

  it('applies exactly the verified plan after a successful redemption', async () => {
    const h = hooks();
    await expect(run(deps(fakeStore(record())), h)).resolves.toBe('done');
    expect(h.mutations).toEqual([{ planHash: HASH, details: { steps: 2 } }]);
  });
});

describe('shared authorization refusal pins', () => {
  const deny: AuthorizeFn = async () => ({ allowed: false, reason: 'no_grant' });

  it('plan() names the read permission in its NOT_AUTHORIZED message', async () => {
    await expect(plan({ deps: deps(fakeStore(null), deny), principalId: 'u-1', principalKind: 'user', hooks: hooks() }))
      .rejects.toMatchObject({ reasonCode: 'NOT_AUTHORIZED', message: "principal 'u-1' is not authorized for 'db.read' (no_grant)" });
  });

  it('confirm() names the mutate permission in its NOT_AUTHORIZED message', async () => {
    await expect(confirm({ deps: deps(fakeStore(null), deny), principalId: 'u-1', principalKind: 'user', hooks: hooks(), planId: 'plan-1', planHash: HASH }))
      .rejects.toMatchObject({ reasonCode: 'NOT_AUTHORIZED', message: "principal 'u-1' is not authorized for 'db.migrate' (no_grant)" });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ConnectionBudgetExceededError, HOST_BUDGET_MAXIMUM, createConnectionBudgets, parseConnectionBudgets, type ConnectionBudget, type ConnectionBudgetLimiter } from '../budgets.js';

const inst = { scope: 'instance', ...HOST_BUDGET_MAXIMUM } as const;

describe('parseConnectionBudgets', () => {
  it('defaults an undeclared list to the host maximum instance budget', () => {
    expect(parseConnectionBudgets({ value: undefined, at: 'b' })).toEqual([inst]);
  });

  it('refuses a non-list and a list longer than the scope count', () => {
    expect(parseConnectionBudgets({ value: 'x', at: 'b' })).toBe('b must be a list of at most 2 budgets');
    expect(parseConnectionBudgets({ value: [{}, {}, {}], at: 'b' })).toBe('b must be a list of at most 2 budgets');
  });

  it('refuses a non-object entry and an unknown scope', () => {
    expect(parseConnectionBudgets({ value: [null], at: 'b' })).toBe('b[0] must be an object');
    expect(parseConnectionBudgets({ value: [3], at: 'b' })).toBe('b[0] must be an object');
    expect(parseConnectionBudgets({ value: [{ scope: 'galaxy', perMinute: 1 }], at: 'b' })).toBe('b[0].scope must be "instance" or "connection"');
  });

  it.each([
    [{ scope: 'instance', perMinute: 0 }],
    [{ scope: 'instance', perMinute: 1.5 }],
    [{ scope: 'instance', perMinute: '5' }],
    [{ scope: 'instance', perMinute: Number.MAX_SAFE_INTEGER + 2 }],
    [{ scope: 'instance', perMinute: 5, burst: -1 }],
    [{ scope: 'instance', perMinute: 5, burst: 0.5 }],
    [{ scope: 'instance' }],
  ])('refuses invalid counts %j', (entry) => {
    expect(parseConnectionBudgets({ value: [entry], at: 'b' })).toBe('b[0].perMinute must be a whole number of at least 1, and burst a whole number of at least 0');
  });

  it('clamps to the host maximum, defaults burst to 0 and keeps declared order', () => {
    expect(parseConnectionBudgets({ value: [{ scope: 'connection', perMinute: 10_000, burst: 999 }, { scope: 'instance', perMinute: 5 }], at: 'b' })).toEqual([
      { scope: 'connection', perMinute: 240, burst: 40 }, { scope: 'instance', perMinute: 5, burst: 0 },
    ]);
  });

  it('refuses a scope declared twice, naming its index', () => {
    expect(parseConnectionBudgets({ value: [{ scope: 'instance', perMinute: 1 }, { scope: 'instance', perMinute: 2 }], at: 'b' })).toBe('b[1].scope "instance" is declared twice');
  });

  it('adds the host-maximum instance budget in front when only a connection budget is declared', () => {
    expect(parseConnectionBudgets({ value: [{ scope: 'connection', perMinute: 3 }], at: 'b' })).toEqual([inst, { scope: 'connection', perMinute: 3, burst: 0 }]);
  });
});

describe('ConnectionBudgetExceededError', () => {
  it('carries retry guidance and the not-applied outcome', () => {
    const error = new ConnectionBudgetExceededError({ retryAfterMs: 1500 });
    expect(error).toMatchObject({ name: 'ConnectionBudgetExceededError', code: 'rate-limited', retryable: true, retryAfterMs: 1500, outcome: 'not-applied' });
    expect(error.message).toBe('This plugin reached its per-minute request budget for this service. Nothing was sent; retry after the wait.');
  });
});

describe('createConnectionBudgets', () => {
  const clock = { nowMs: () => 0 } as never;
  const target = (budgets: readonly ConnectionBudget[]) => ({ workspaceId: 'w', pluginId: 'p', connectionId: 'c', connectionRef: 'ref-1', budgets });

  function harness(verdicts: (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number } = () => ({ allowed: true })) {
    const checks: string[] = [];
    const createLimiter = vi.fn(({ profile }: { profile: unknown }): ConnectionBudgetLimiter => ({
      async check({ key }) { checks.push(`${JSON.stringify(profile)}|${key}`); return verdicts(key); },
    }));
    return { budgets: createConnectionBudgets({ clock, createLimiter: createLimiter as never }), createLimiter, checks };
  }

  it('charges the per-account budget before the instance one, keyed by workspace/plugin/connection', async () => {
    const h = harness();
    await h.budgets.charge(target([{ scope: 'instance', perMinute: 10, burst: 2 }, { scope: 'connection', perMinute: 5, burst: 0 }]));
    expect(h.checks).toEqual([
      `{"windowSeconds":60,"max":5,"burst":0}|w\u0000p\u0000c\u0000ref-1`,
      `{"windowSeconds":60,"max":10,"burst":2}|w\u0000p\u0000c\u0000`,
    ]);
  });

  it('reuses one limiter per distinct clamped profile', async () => {
    const h = harness();
    await h.budgets.charge(target([{ scope: 'instance', perMinute: 10, burst: 2 }]));
    await h.budgets.charge({ ...target([{ scope: 'instance', perMinute: 10, burst: 2 }]), pluginId: 'other' });
    await h.budgets.charge(target([{ scope: 'instance', perMinute: 11, burst: 2 }]));
    expect(h.createLimiter).toHaveBeenCalledTimes(2);
    expect(h.createLimiter).toHaveBeenCalledWith({ profile: { windowSeconds: 60, max: 10, burst: 2 }, clock });
  });

  it('refuses with a millisecond retry delay and never spends the instance budget when the account budget refuses', async () => {
    const h = harness(key => key.endsWith('ref-1') ? { allowed: false, retryAfterSeconds: 7 } : { allowed: true });
    const error = await h.budgets.charge(target([{ scope: 'instance', perMinute: 10, burst: 0 }, { scope: 'connection', perMinute: 5, burst: 0 }])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionBudgetExceededError);
    expect((error as ConnectionBudgetExceededError).retryAfterMs).toBe(7000);
    expect(h.checks).toHaveLength(1);
  });

  it('does nothing for a target with no budgets', async () => {
    const h = harness();
    await expect(h.budgets.charge(target([]))).resolves.toBeUndefined();
    expect(h.checks).toEqual([]);
  });
});

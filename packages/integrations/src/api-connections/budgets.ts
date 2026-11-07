import type { Clock } from '@jini-ai/core/primitives';

/**
 * @file Per-minute request budgets a plugin declares on one of its API connections (`budgets` in
 * the plugin's connections file), parsed, clamped and enforced by the host through its own
 * fixed-window limiter (the `createLimiter` port).
 *
 * Exists so a plugin can stay under its provider's quota without trusting the plugin to pace
 * itself: every token read for a connection (one per authenticated request, by the host's
 * capability rule) is charged here first, for chat tools, admin-surface actions and form delivery
 * alike. Budgets are keyed by workspace, plugin and connection, so a plugin can never spend another
 * plugin's or the host's budget, and every value is clamped to {@link HOST_BUDGET_MAXIMUM}. Counters
 * live in this process's memory: each process that composes the host keeps its own.
 */

/** `instance`: this site's share, all accounts of one declared connection. `connection`: one signed-in account. */
export type ConnectionBudgetScope = "instance" | "connection";

export interface ConnectionBudget {
  readonly scope: ConnectionBudgetScope;
  readonly perMinute: number;
  /** Extra calls allowed in a window on top of `perMinute` (http-kit counts `max + burst`). */
  readonly burst: number;
}

/** The most any plugin may declare per scope; also the instance budget of a connection that declares none. */
export const HOST_BUDGET_MAXIMUM = Object.freeze({ perMinute: 240, burst: 40 });
const SCOPES: readonly ConnectionBudgetScope[] = ["instance", "connection"];

function isCount(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

/** One entry, clamped, or why it is invalid. @complexity O(1). */
function parseBudget(entry: unknown, at: string): ConnectionBudget | string {
  if (typeof entry !== "object" || entry === null) return `${at} must be an object`;
  const { scope, perMinute, burst = 0 } = entry as Record<string, unknown>;
  if (!SCOPES.includes(scope as ConnectionBudgetScope)) return `${at}.scope must be "instance" or "connection"`;
  if (!isCount(perMinute, 1) || !isCount(burst, 0)) return `${at}.perMinute must be a whole number of at least 1, and burst a whole number of at least 0`;
  return { scope: scope as ConnectionBudgetScope, perMinute: Math.min(perMinute, HOST_BUDGET_MAXIMUM.perMinute), burst: Math.min(burst, HOST_BUDGET_MAXIMUM.burst) };
}

/**
 * A declaration's `budgets`, clamped, always with an instance budget (the host maximum when the
 * plugin declares none), or why they are invalid. An invalid entry refuses the declaration rather
 * than loading the connection unbounded.
 * @complexity O(b), b ≤ 2 entries.
 */
export function parseConnectionBudgets(required: { readonly value: unknown; readonly at: string }, _optional: Record<string, never> = {}): readonly ConnectionBudget[] | string {
  const { value, at } = required;
  if (value === undefined) return [{ scope: "instance", ...HOST_BUDGET_MAXIMUM }];
  if (!Array.isArray(value) || value.length > SCOPES.length) return `${at} must be a list of at most ${SCOPES.length} budgets`;
  const budgets: ConnectionBudget[] = [];
  for (const [index, entry] of value.entries()) {
    const budget = parseBudget(entry, `${at}[${index}]`);
    if (typeof budget === "string") return budget;
    if (budgets.some((seen) => seen.scope === budget.scope)) return `${at}[${index}].scope "${budget.scope}" is declared twice`;
    budgets.push(budget);
  }
  return budgets.some((budget) => budget.scope === "instance") ? budgets : [{ scope: "instance", ...HOST_BUDGET_MAXIMUM }, ...budgets];
}

/** A charge the budget refused. Nothing was sent, so the caller may retry after `retryAfterMs`. */
export class ConnectionBudgetExceededError extends Error {
  readonly code = "rate-limited";
  readonly retryable = true;
  readonly retryAfterMs: number;
  readonly outcome = "not-applied";
  constructor(required: { readonly retryAfterMs: number }, _optional: Record<string, never> = {}) {
    super("This plugin reached its per-minute request budget for this service. Nothing was sent; retry after the wait.");
    this.name = "ConnectionBudgetExceededError";
    this.retryAfterMs = required.retryAfterMs;
  }
}

/** What one charge spends: the calling plugin's connection and the account its ref names. */
export interface ConnectionBudgetTarget {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly connectionId: string;
  /** Must already be verified as this plugin's own ref, so forged refs never create counters. */
  readonly connectionRef: string;
  readonly budgets: readonly ConnectionBudget[];
}

/** The fixed-window profile one limiter enforces: `max + burst` calls per `windowSeconds`. */
export interface ConnectionBudgetLimiterProfile {
  readonly windowSeconds: number;
  readonly max: number;
  readonly burst: number;
}

/** The host's fixed-window limiter, as much of it as budgets use. `check` evaluates and records one call. */
export interface ConnectionBudgetLimiter {
  check(required: { readonly key: string }): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number }>;
}

/** Port: builds one in-memory limiter for a profile over the host's clock. */
export type CreateConnectionBudgetLimiter = (required: { readonly profile: ConnectionBudgetLimiterProfile; readonly clock: Clock }) => ConnectionBudgetLimiter;

/**
 * The host's budget enforcer. One limiter per distinct clamped profile (bounded by the maxima).
 * The per-account budget is checked first, so a busy account's refused calls never spend the
 * instance budget its siblings share.
 * @complexity O(b) limiter checks per charge.
 */
export function createConnectionBudgets(required: { readonly clock: Clock; readonly createLimiter: CreateConnectionBudgetLimiter }, _optional: Record<string, never> = {}) {
  const limiters = new Map<string, ConnectionBudgetLimiter>();

  function limiterFor(budget: ConnectionBudget): ConnectionBudgetLimiter {
    const id = `${budget.perMinute}/${budget.burst}`;
    let limiter = limiters.get(id);
    if (!limiter) {
      const profile: ConnectionBudgetLimiterProfile = { windowSeconds: 60, max: budget.perMinute, burst: budget.burst };
      limiter = required.createLimiter({ profile, clock: required.clock });
      limiters.set(id, limiter);
    }
    return limiter;
  }

  return {
    async charge(target: ConnectionBudgetTarget, _options: Record<string, never> = {}): Promise<void> {
      const ordered = [...target.budgets].sort((a, b) => SCOPES.indexOf(b.scope) - SCOPES.indexOf(a.scope));
      for (const budget of ordered) {
        // NUL cannot appear in a workspace, plugin or connection id, so no key can name another's budget.
        // The account segment is empty only for `instance`: an owned ref is never empty, so the two
        // scopes' keys differ even when their profiles (and so their limiter) are the same.
        const account = budget.scope === "connection" ? target.connectionRef : "";
        const key = [target.workspaceId, target.pluginId, target.connectionId, account].join("\u0000");
        const verdict = await limiterFor(budget).check({ key });
        if (!verdict.allowed) throw new ConnectionBudgetExceededError({ retryAfterMs: verdict.retryAfterSeconds * 1000 });
      }
    },
  };
}

export type ConnectionBudgets = ReturnType<typeof createConnectionBudgets>;

import { randomUUID } from "node:crypto";

/**
 * @file Holds a planned site backup between `site_backup_plan` and `site_backup_push`, in memory.
 *
 * A plan carries the database snapshot's bytes, so the push uploads exactly the database the human
 * reviewed and no snapshot file ever sits on disk waiting to be orphaned. That is also why this
 * store is small and short-lived: at most {@link DEFAULT_MAX_PLANS} plans per principal and
 * workspace and {@link DEFAULT_MAX_TOTAL_PLANS} overall, each for {@link DEFAULT_PLAN_TTL_MS}, the
 * oldest evicted first, and expired plans swept on every save. The per-caller cap means other
 * callers' plans never evict a caller's plan; only the overall memory ceiling can.
 *
 * A plan is single-use and bound to the principal and workspace that made it: {@link
 * SiteBackupPlanStore.take} deletes it, and another principal's id reads as not found — never as
 * "exists but not yours", which would confirm a guessed id.
 *
 * In memory only: a server restart drops every plan, and the push then says to plan again.
 */

export type SiteBackupPlan<T extends object> = T & {
  readonly planId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly expiresAtMs: number;
}

export type TakeSiteBackupPlanResult<T extends object> = { ok: true; plan: SiteBackupPlan<T> } | { ok: false; code: "PLAN_NOT_FOUND" | "PLAN_EXPIRED" };

export const DEFAULT_PLAN_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_PLANS = 2;
export const DEFAULT_MAX_TOTAL_PLANS = 8;

export class SiteBackupPlanStore<T extends object> {
  private readonly plans = new Map<string, SiteBackupPlan<T>>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  /** Per principal and workspace. */
  private readonly maxPlans: number;
  private readonly maxTotalPlans: number;
  private readonly newId: () => string;

  constructor(_required: Record<string, never>, optional: { now?: () => number; ttlMs?: number; maxPlans?: number; maxTotalPlans?: number; newId?: () => string } = {}) {
    this.now = optional.now ?? Date.now;
    this.ttlMs = optional.ttlMs ?? DEFAULT_PLAN_TTL_MS;
    this.maxPlans = optional.maxPlans ?? DEFAULT_MAX_PLANS;
    this.maxTotalPlans = optional.maxTotalPlans ?? DEFAULT_MAX_TOTAL_PLANS;
    this.newId = optional.newId ?? randomUUID;
  }

  /**
   * Stores a plan and returns it with its id and expiry. Expired plans are swept first, then the
   * caller's oldest plans are evicted until it has room, then the oldest overall past the ceiling.
   *
   * @complexity O(plans held), which is at most `maxTotalPlans`.
   */
  save(input: { principalId: string; workspaceId: string; content: T }, _optional: Record<string, never> = {}): SiteBackupPlan<T> {
    const nowMs = this.now();
    for (const [id, plan] of this.plans) {
      if (plan.expiresAtMs <= nowMs) this.plans.delete(id);
    }
    this.makeRoom({ limit: this.maxPlans }, { owns: ({ plan }, _optional = {}) => plan.principalId === input.principalId && plan.workspaceId === input.workspaceId });
    this.makeRoom({ limit: this.maxTotalPlans });
    const plan: SiteBackupPlan<T> = { ...input.content, planId: this.newId(), principalId: input.principalId, workspaceId: input.workspaceId, expiresAtMs: nowMs + this.ttlMs };
    this.plans.set(plan.planId, plan);
    return plan;
  }

  /** Evicts the oldest matching plans so one more fits under `limit` (a zero limit evicts all of them). */
  private makeRoom(required: { limit: number }, optional: { owns?: (required: { plan: SiteBackupPlan<T> }, optional?: Record<string, never>) => boolean } = {}): void {
    const ids = [...this.plans.values()].filter(plan => optional.owns?.({ plan }) ?? true).map(plan => plan.planId);
    for (const id of ids.slice(0, Math.max(0, ids.length - required.limit + 1))) this.plans.delete(id);
  }

  /**
   * Removes and returns the plan, once. A plan made by another principal or workspace reads as
   * `PLAN_NOT_FOUND` and is left in place; an expired one is removed and reads as `PLAN_EXPIRED`.
   *
   * @complexity O(1).
   */
  take(input: { planId: string; principalId: string; workspaceId: string }, _optional: Record<string, never> = {}): TakeSiteBackupPlanResult<T> {
    const plan = this.plans.get(input.planId);
    if (!plan || plan.principalId !== input.principalId || plan.workspaceId !== input.workspaceId) return { ok: false, code: "PLAN_NOT_FOUND" };
    this.plans.delete(input.planId);
    if (plan.expiresAtMs <= this.now()) return { ok: false, code: "PLAN_EXPIRED" };
    return { ok: true, plan };
  }
}

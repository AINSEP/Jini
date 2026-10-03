import { randomUUID } from "node:crypto";

import type { TargetDescription } from "../transfer/postgres-target.js";

/**
 * @file Holds a planned copy between `database_transfer_plan` and `database_transfer_run`: the
 * database snapshot bytes (so the run copies exactly what was planned, "the site as of HH:MM"), the
 * row counts shown to the human, and the connection string. In memory only — a restart drops every
 * plan — single-use, bound to the principal and workspace that made it, and gone after 10 minutes.
 * The connection string lives here and nowhere else, and is never returned by any tool.
 */

export interface DatabaseTransferPlanContent {
  readonly connectionString: string;
  readonly destination: TargetDescription;
  /** The earlier copy this one replaces, by its source snapshot time; `null` for a first copy. */
  readonly replaces: string | null;
  readonly snapshot: Buffer;
  /** Immutable bytes of the second, separately captured database. Both captures precede planning. */
  readonly chatSnapshot?: Buffer;
  readonly snapshotAt: string;
  readonly site: string;
  /** The private schema this site's copy goes to, chosen by `inspectTarget` at plan time. */
  readonly schema: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly leftOut: readonly { readonly table: string; readonly rows: number; readonly reason: string }[];
}

export interface DatabaseTransferPlan extends DatabaseTransferPlanContent {
  readonly planId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly expiresAtMs: number;
}

export type TakeDatabaseTransferPlanResult = { ok: true; plan: DatabaseTransferPlan } | { ok: false; code: "PLAN_NOT_FOUND" | "PLAN_EXPIRED" };

const DEFAULT_PLAN_TTL_MS = 10 * 60 * 1000;
/** Each plan holds a whole database snapshot, so only a couple are kept. */
const DEFAULT_MAX_PLANS = 2;

export class DatabaseTransferPlanStore {
  private readonly plans = new Map<string, DatabaseTransferPlan>();
  private readonly now: () => number;

  constructor(_required: Record<string, never> = {}, optional: { now?: () => number } = {}) {
    this.now = optional.now ?? Date.now;
  }

  /** @complexity O(plans held), at most {@link DEFAULT_MAX_PLANS}. */
  save(input: { principalId: string; workspaceId: string; content: DatabaseTransferPlanContent }, _optional = {}): DatabaseTransferPlan {
    const nowMs = this.now();
    for (const [id, plan] of this.plans) {
      if (plan.expiresAtMs <= nowMs) this.plans.delete(id);
    }
    while (this.plans.size >= DEFAULT_MAX_PLANS) {
      const oldest = this.plans.keys().next().value;
      if (oldest === undefined) break;
      this.plans.delete(oldest);
    }
    const plan: DatabaseTransferPlan = { ...input.content, planId: randomUUID(), principalId: input.principalId, workspaceId: input.workspaceId, expiresAtMs: nowMs + DEFAULT_PLAN_TTL_MS };
    this.plans.set(plan.planId, plan);
    return plan;
  }

  /** Single-use: a taken plan is gone whether or not it is still valid. */
  take(input: { planId: string; principalId: string; workspaceId: string }, _optional = {}): TakeDatabaseTransferPlanResult {
    const plan = this.plans.get(input.planId);
    if (!plan || plan.principalId !== input.principalId || plan.workspaceId !== input.workspaceId) return { ok: false, code: "PLAN_NOT_FOUND" };
    this.plans.delete(input.planId);
    if (plan.expiresAtMs <= this.now()) return { ok: false, code: "PLAN_EXPIRED" };
    return { ok: true, plan };
  }
}


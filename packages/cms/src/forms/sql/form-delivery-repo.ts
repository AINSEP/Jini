import type { DomainEvent, OutboxRecord } from "@jini-ai/core/contracts/events";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import {
  type FormDeliveryQueuedJob, type FormDeliveryPlan, type FormDeliveryPlanPort,
  type FormDeliveryJobStatus, formDeliveryStatusFromOutbox,
} from "../delivery/index.js";
import { DELIVERY_STATUS_MAX_LIMIT } from "../delivery-status-limits.js";
import type { Generated, Insertable, Kysely } from "kysely";

const JOB_WORKSPACE_ID = "j.workspace_id";
const JOB_SUBMISSION_ID = "j.submission_id";


/**
 * @file SQL adapters (one Kysely body for SQLite and Postgres) for durable form delivery
 * (migration 0019): the plan-once store behind `@jini-ai/cms/forms`' `FormDeliveryPlanPort`, the
 * per-binding status reads, and the receiver pull lease behind `FormPullLeasePort`.
 *
 * Status is never stored here. It is projected from each child job's injected outbox table row by the
 * Jini `formDeliveryStatusFromOutbox`, so the outbox worker stays the only state machine. The
 * job payload lives only in the injected outbox table (legacy payloads include answers; new jobs reference
 * the source row); the injected jobs table holds
 * just the ids a status read prints, so status reads never load answers.
 */

type FormDeliveryStatusRow = {
  bindingId: string; adapterId: string; formId: string; submissionId: string;
} & FormDeliveryJobStatus;

interface PlanRow {
  workspace_id: string;
  submission_id: string;
  form_id: string;
}

interface JobRow {
  job_id: string;
  workspace_id: string;
  submission_id: string;
  binding_id: string;
  adapter_id: string;
}

interface OutboxRow {
  id: string;
  workspace_id: string;
  event_json: string;
  status: string;
  attempts: Generated<number>;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
}

/** Outbox statuses that are not `delivered`; matches the outbox claim index's leading column. */
const UNFINISHED_STATUSES = ["pending", "processing", "failed"];

/** The safe code a purged submission's unfinished jobs fail with (the contract has no closer one). */
const PURGED_JOB_ERROR = "delivery-failed";

interface StatusSqlRow {
  binding_id: string; adapter_id: string; form_id: string; submission_id: string;
  status: string; attempts: number; next_attempt_at: string; last_error: string | null;
}

/** The status columns of `workspaceId`'s jobs: the job index row, its outbox row and its plan. */
function statusQuery({ db, workspaceId, tables }: { db: Kysely<unknown>; workspaceId: string; tables: { plans: string; jobs: string; outboxEvents: string } }, _optional: Record<string, never> = {}) {
  return db.withTables<Record<string, JobRow & OutboxRow & PlanRow>>().selectFrom(`${tables.jobs} as j`)
    .innerJoin(`${tables.outboxEvents} as o`, "o.id", "j.job_id")
    .innerJoin(`${tables.plans} as p`, join => join.onRef("p.workspace_id", "=", JOB_WORKSPACE_ID).onRef("p.submission_id", "=", JOB_SUBMISSION_ID))
    .select(["j.binding_id", "j.adapter_id", "p.form_id", JOB_SUBMISSION_ID, "o.status", "o.attempts", "o.next_attempt_at", "o.last_error"])
    .where(JOB_WORKSPACE_ID, "=", workspaceId);
}

/** The job's outbox columns once its submission is purged: answers blanked, and an unfinished job
 * failed so the worker never claims it again. `failed` is terminal for the outbox worker. */
function purgedJobColumns(row: { event_json: string; status: string }) {
  const event = JSON.parse(row.event_json) as DomainEvent<FormDeliveryQueuedJob>;
  const payload = "snapshot" in event.payload
    ? { ...event.payload, snapshot: { ...event.payload.snapshot, submission: { ...event.payload.snapshot.submission, answers: {} } } }
    : event.payload;
  const scrubbed = { event_json: JSON.stringify({ ...event, payload }) };
  return row.status === "pending" || row.status === "processing" ? { ...scrubbed, status: "failed", last_error: PURGED_JOB_ERROR } : scrubbed;
}

function toStatusRow(row: StatusSqlRow): FormDeliveryStatusRow {
  const status = formDeliveryStatusFromOutbox({ row: {
    status: row.status as OutboxRecord["status"], attempts: row.attempts, nextAttemptAt: row.next_attempt_at, lastError: row.last_error,
  } });
  return { bindingId: row.binding_id, adapterId: row.adapter_id, formId: row.form_id, submissionId: row.submission_id, ...status };
}

/** Refuses a plan or child job built for another workspace or submission: the plan row and its
 * jobs are keyed by the REQUESTED identity, so a mismatch would file one workspace's deliveries
 * (and answers) under another. */
function assertSameIdentity(required: { requested: { workspaceId: string; submissionId: string }; what: string; workspaceId: string; submissionId: string | undefined }): void {
  const { requested } = required;
  if (required.workspaceId === requested.workspaceId && required.submissionId === requested.submissionId) return;
  throw new Error(`Form delivery plan refused: ${required.what} is for workspace ${required.workspaceId}, submission ${required.submissionId}, ` +
    `not workspace ${requested.workspaceId}, submission ${requested.submissionId}. The planner must build for the requested submission; nothing was stored.`);
}

/** Plans (plan-once with child jobs) and per-binding status reads. */
export class SqlFormDeliveryRepo implements FormDeliveryPlanPort {
  private readonly required: { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: { plans: string; jobs: string; outboxEvents: string }; outboxRow: (event: DomainEvent<object>) => Insertable<OutboxRow> };
  constructor(required: { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: { plans: string; jobs: string; outboxEvents: string }; outboxRow: (event: DomainEvent<object>) => Insertable<OutboxRow> }, _optional: Record<string, never> = {}) {
    this.required = required;
  }

  /**
   * Returns the stored plan, or runs `build` and stores the plan row, every child outbox job and
   * its index row in ONE transaction. `lockKey` serializes concurrent callers for the same
   * submission on Postgres (on SQLite the write transaction already does), so a replayed source
   * event never plans twice. A replay returns the jobs from the outbox in job-id order (each job
   * delivers independently, so order carries no meaning).
   * @throws Error when the built plan or a child job names another workspace/submission (rolled back).
   * @complexity O(jobs) inserts on first call; one indexed read on replay.
   */
  async once(
    required: { workspaceId: string; submissionId: string; build: () => Promise<FormDeliveryPlan> },
    _optional: Record<string, never> = {},
  ): Promise<FormDeliveryPlan> {
    const { kernel } = this.required;
    const { workspaceId, submissionId } = required;
    return kernel.transaction(async () => {
      await kernel.lockKey(JSON.stringify(["form-delivery-plan", workspaceId, submissionId]));
      const stored = await this.storedPlan({ workspaceId, submissionId });
      if (stored) return stored;
      const plan = await required.build();
      await this.store({ requested: { workspaceId, submissionId }, plan });
      return plan;
    });
  }

  private async storedPlan(required: { workspaceId: string; submissionId: string }): Promise<FormDeliveryPlan | null> {
    const { workspaceId, submissionId } = required;
    const row = await this.required.kernel.run(db => db.withTables<Record<string, PlanRow>>().selectFrom(this.required.tables.plans).select("form_id")
      .where("workspace_id", "=", workspaceId).where("submission_id", "=", submissionId).executeTakeFirst());
    if (!row) return null;
    const jobs = await this.required.kernel.run(db => db.withTables<Record<string, JobRow & OutboxRow>>().selectFrom(`${this.required.tables.jobs} as j`)
      .innerJoin(`${this.required.tables.outboxEvents} as o`, "o.id", "j.job_id").select("o.event_json")
      .where(JOB_WORKSPACE_ID, "=", workspaceId).where(JOB_SUBMISSION_ID, "=", submissionId).orderBy("j.job_id").execute());
    return { workspaceId, submissionId, formId: row.form_id, jobs: jobs.map(job => JSON.parse(job.event_json) as DomainEvent<FormDeliveryQueuedJob>) };
  }

  private async store(required: { requested: { workspaceId: string; submissionId: string }; plan: FormDeliveryPlan }): Promise<void> {
    const { requested, plan } = required;
    assertSameIdentity({ requested, what: "the built plan", workspaceId: plan.workspaceId, submissionId: plan.submissionId });
    for (const job of plan.jobs) assertSameIdentity({ requested, what: `child job ${job.id}`, workspaceId: job.workspaceId, submissionId: job.aggregateId });
    const { kernel } = this.required;
    await kernel.run(db => db.withTables<Record<string, PlanRow>>().insertInto(this.required.tables.plans)
      .values({ workspace_id: plan.workspaceId, submission_id: plan.submissionId, form_id: plan.formId }).execute());
    for (const job of plan.jobs) {
      await kernel.run(db => db.withTables<Record<string, OutboxRow>>().insertInto(this.required.tables.outboxEvents).values(this.required.outboxRow(job)).execute());
      await kernel.run(db => db.withTables<Record<string, JobRow>>().insertInto(this.required.tables.jobs).values({ job_id: job.id, workspace_id: plan.workspaceId,
        submission_id: plan.submissionId, binding_id: job.payload.binding.bindingId, adapter_id: job.payload.binding.adapterId }).execute());
    }
  }

  /**
   * After a permanent delete (a Trash purge of the submission, or of its form with every submission
   * it had): blanks the answers frozen into those submissions' delivery jobs and fails the jobs not
   * yet finished, so the deleted answers neither stay in the host nor reach a destination later.
   * Copies a destination already received are outside the host and stay. Runs inside the purge's own
   * transaction (the kernel joins it), so the purge and the scrub commit or roll back together.
   * @complexity O(jobs of the purged submissions): one indexed read, one update per job.
   */
  async scrubPurged(
    required: { workspaceId: string; purged: { submissionId: string } | { formId: string } },
    _optional: Record<string, never> = {},
  ): Promise<void> {
    const { kernel } = this.required;
    const { workspaceId, purged } = required;
    const [column, id] = "submissionId" in purged ? ["p.submission_id", purged.submissionId] as const : ["p.form_id", purged.formId] as const;
    const jobs = await kernel.run(db => db.withTables<Record<string, JobRow & PlanRow & OutboxRow>>().selectFrom(`${this.required.tables.jobs} as j`)
      .innerJoin(`${this.required.tables.plans} as p`, join => join.onRef("p.workspace_id", "=", JOB_WORKSPACE_ID).onRef("p.submission_id", "=", JOB_SUBMISSION_ID))
      .innerJoin(`${this.required.tables.outboxEvents} as o`, "o.id", "j.job_id")
      .select(["o.id", "o.event_json", "o.status"])
      .where(JOB_WORKSPACE_ID, "=", workspaceId).where(column, "=", id).execute());
    for (const job of jobs) {
      await kernel.run(db => db.withTables<Record<string, OutboxRow>>().updateTable(this.required.tables.outboxEvents).set(purgedJobColumns(job)).where("id", "=", job.id).execute());
    }
  }

  /** Indexed stable-id range, at most four grouped status counts, on detail reads only.
   * No recipient addresses, event payloads or provider error messages leave storage.
   * @complexity O(recipient jobs for this submission), constant response bytes. */
  async notificationSummary({ workspaceId, submissionId }: { workspaceId: string; submissionId: string }, _optional = {}): Promise<{ failed: number; pending: number }> {
    const prefix = `forms:notify:${submissionId}:`;
    const rows = await this.required.kernel.run(db => db.withTables<Record<string, OutboxRow>>().selectFrom(this.required.tables.outboxEvents)
      .select(['status', db.fn.countAll().as('count')]).where('workspace_id', '=', workspaceId)
      .where('id', '>=', prefix).where('id', '<', prefix + '\uffff').groupBy('status').execute());
    return { failed: Number(rows.find(row => row.status === 'failed')?.count ?? 0),
      pending: rows.filter(row => row.status === 'pending' || row.status === 'processing').reduce((total, row) => total + Number(row.count), 0) };
  }

  /**
   * Every binding's status for one submission of `workspaceId`, ordered by binding id.
   * @complexity O(bindings of the submission), via the jobs binding index and primary keys.
   */
  async forSubmission(required: { workspaceId: string; submissionId: string }, _optional: Record<string, never> = {}): Promise<FormDeliveryStatusRow[]> {
    const { kernel } = this.required;
    const rows = await kernel.run(db => statusQuery({ db, workspaceId: required.workspaceId, tables: this.required.tables }).where(JOB_SUBMISSION_ID, "=", required.submissionId)
      .orderBy("j.binding_id").execute());
    return rows.map(toStatusRow);
  }

  /**
   * The most recent jobs of `workspaceId` that are not completed (pending, retrying or failed),
   * newest first, `limit` of them (default {@link DELIVERY_STATUS_MAX_LIMIT}).
   * @param optional.limit not validated here: the only caller, `forms_delivery_status`, already
   *   refuses anything but an integer from 1 to {@link DELIVERY_STATUS_MAX_LIMIT}.
   * @complexity Driven from the outbox claim index (undelivered rows only), joined by primary key.
   */
  async recentUnfinished(required: { workspaceId: string }, optional: { limit?: number } = {}): Promise<FormDeliveryStatusRow[]> {
    const { kernel } = this.required;
    const rows = await kernel.run(db => statusQuery({ db, workspaceId: required.workspaceId, tables: this.required.tables }).where("o.status", "in", UNFINISHED_STATUSES)
      .orderBy("o.created_at", "desc").orderBy("o.id", "desc").limit(optional.limit ?? DELIVERY_STATUS_MAX_LIMIT).execute());
    return rows.map(toStatusRow);
  }
}

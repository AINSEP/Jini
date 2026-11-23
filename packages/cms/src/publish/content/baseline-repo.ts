/**
 * @file Task 7 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §2/§4 task 7.
 *
 * Read/write seam over `publish_content_baselines` (migration `0066`, `platform/db/schema.sqlite.ts`) —
 * "per-peer sync memory: the content hash of each entity as last exchanged with that peer" (that
 * table's own doc comment). `planImport()` (Task 5, `planner.ts`) only ever READS through this port
 * (`PlanImportDeps.getBaseline`, wired in `gated-hooks.ts`); nothing in Task 7 ever calls
 * {@link PublishContentBaselineRepoPort.upsert} — that write belongs to Task 8's apply loop
 * ("baseline upserted for `created`/`unchanged`/`applied`/`forced` only", plan §4 task 8). This file
 * defines the whole port now (read AND write) because it is one small cohesive unit over one table,
 * but Task 7 itself exercises only the read half.
 *
 * Plan §1.6 / §5 risk #9: `peerPrincipalId` is always the AUTHENTICATED principal who pushed/staged
 * the bundle being compared (`StagedBundleRecord.sourcePrincipalId` — see `bundle-staging.ts`'s own
 * doc, "mirrors `publish_content_baselines.peerPrincipalId`'s own rule"), never a bundle-declared
 * identity and never the confirming/executing admin's own principal id. A caller building the key
 * this port reads/writes by must use that value, not `req`'s authenticated principal — getting this
 * backwards would let any key-holder poison another peer's baselines into "safe to overwrite".
 */

/** One persisted baseline row — mirrors `publishContentBaselines` (`platform/db/schema.sqlite.ts`)
 *  field-for-field. */
export interface PublishContentBaselineRecord {
  readonly workspaceId: string;
  readonly peerPrincipalId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly hashAtLastSync: string;
  /** Which `CONTENT_HASH_VERSION` generation produced {@link hashAtLastSync} — `planner.ts`'s own
   *  pass 1 refuses the whole run rather than comparing across generations (`content-hash.ts`'s
   *  header). */
  readonly hashVersion: number;
  readonly syncedAt: string;
  /** The `publish_content_runs` row this baseline was last stamped by (Task 8/10's audit trail) —
   *  opaque to this port; never inspected or compared here. */
  readonly runId: string;
}

export interface PublishContentBaselineRepoPort {
  /** One entity's baseline for one peer, or `null` when this peer+entity pair has never synced —
   *  `planner.ts`'s own "no baseline is a `conflict`, never a free pass to `created`" rule (its file
   *  header) depends on this returning `null` rather than throwing for the common "never synced"
   *  case. */
  findOne(input: {
    workspaceId: string;
    peerPrincipalId: string;
    entityType: string;
    entityId: string;
  }, optional?: {}): Promise<PublishContentBaselineRecord | null>;
  /** Replaces the baseline for `(workspaceId, peerPrincipalId, entityType, entityId)` — the table's
   *  own `publish_content_baselines_unique` index target. Not called anywhere in Task 7; Task 8's
   *  apply loop is the real caller (plan §4 task 8's own "baseline upserted for created/unchanged/
   *  applied/forced only"). */
  upsert(required: { record: PublishContentBaselineRecord }, optional?: {}): Promise<void>;
}

/** In-process `PublishContentBaselineRepoPort` — hermetic tests and this feature's own unit tests.
 *  Mirrors `InMemoryPublishContentBundleRepo`'s shape (`bundle-staging.ts`): a plain `Map`,
 *  defensive copies on read/write so a caller mutating a returned record can never corrupt this
 *  store's own state. */
export class InMemoryPublishContentBaselineRepo implements PublishContentBaselineRepoPort {
  private readonly recordsByKey = new Map<string, PublishContentBaselineRecord>();

  private static keyOf(input: { workspaceId: string; peerPrincipalId: string; entityType: string; entityId: string }): string {
    return `${input.workspaceId}\u0000${input.peerPrincipalId}\u0000${input.entityType}\u0000${input.entityId}`;
  }

  async findOne(input: {
    workspaceId: string;
    peerPrincipalId: string;
    entityType: string;
    entityId: string;
  }): Promise<PublishContentBaselineRecord | null> {
    const record = this.recordsByKey.get(InMemoryPublishContentBaselineRepo.keyOf(input));
    return record ? { ...record } : null;
  }

  async upsert({ record }: { record: PublishContentBaselineRecord }): Promise<void> {
    this.recordsByKey.set(InMemoryPublishContentBaselineRepo.keyOf(record), { ...record });
  }
}

/**
 * `AsyncOperationStore` — the durable operation row behind submit-then-poll media generation.
 *
 * Why this exists alongside `task-store.ts`'s `MediaTaskStore`: they model different things and
 * only one of them survives a restart usefully. `MediaTaskStore` is a *task tracker* — it records
 * that a generation happened and its `reconcileOnBoot` deliberately marks every still-in-flight
 * task `'interrupted'`, because a synchronous `fetch` that died with its process genuinely cannot
 * be resumed. This store is the opposite case: a vendor-side job that is still running *on the
 * vendor* after our process died, and whose result is still retrievable by polling. It therefore
 * carries the four columns a poll loop needs and a task tracker does not — `attempts`,
 * `nextPollAt`, a worker `lease`, and an absolute `deadlineAt` — and its `reconcileOnBoot`
 * *releases* leases rather than terminating the work.
 *
 * Two independent bounds are mandatory, not redundant: `maxAttempts` catches a vendor that answers
 * "pending" forever, and `deadlineAt` catches a vendor that stops answering at all. Neither one
 * subsumes the other.
 *
 * `state` is the vendor's own resumption handle (a job id, a poll URL). It is deliberately
 * validated on every write to reject credential material: the row outlives the process and is the
 * one place a leaked key would become durable. Credentials are re-resolved per poll tick through
 * the signer seam instead — see `polling-adapter.ts`.
 */

/**
 * `unknown` is a real terminal-ish state, not a failure: it means the operation may or may not
 * have taken effect at the vendor and cannot be safely retried without an idempotency proof. It is
 * reachable only from a crash gap or a blown deadline, and exists so those never masquerade as
 * either success or a retryable failure.
 */
export type AsyncOperationStatus = 'submitted' | 'polling' | 'succeeded' | 'failed' | 'unknown';

/**
 * The persisted shape's version discriminator. Bumped whenever `AsyncOperationRecord`'s stored
 * shape changes; `hydrateAsyncOperationRecord` branches on it so an old row is upgraded on read
 * rather than rescued by a migration script.
 *
 * This is deliberately the same mechanism `ffb5ce44` used to close the AAD gap — a version column,
 * a read path that branches on it, and an idempotent backfill only where one is actually needed —
 * rather than a second migration playbook.
 */
export const ASYNC_OPERATION_SCHEMA_VERSION = 1;

/**
 * Exported (unlike the in-memory-only helpers below it) so a durable adapter — see
 * `sqlite-async-operation-store.ts` — enforces the identical terminal-status and transition rules
 * without hand-copying this table: a second copy is exactly the kind of hand-maintained mirror
 * that drifts silently the next time this one changes.
 */
export const TERMINAL_STATUSES: ReadonlySet<AsyncOperationStatus> = new Set(['succeeded', 'failed', 'unknown']);

const ALLOWED_TRANSITIONS: Readonly<Record<AsyncOperationStatus, ReadonlySet<AsyncOperationStatus>>> = {
  submitted: new Set(['submitted', 'polling', 'succeeded', 'failed', 'unknown']),
  polling: new Set(['polling', 'succeeded', 'failed', 'unknown']),
  succeeded: new Set(['succeeded']),
  failed: new Set(['failed']),
  unknown: new Set(['unknown']),
};

/**
 * Every `AsyncOperationStatus` value, derived from `ALLOWED_TRANSITIONS`'s own key set (which
 * `Record<AsyncOperationStatus, ...>` forces to stay exhaustive) rather than retyped — the same
 * "cannot drift" guarantee `TERMINAL_STATUSES` above already documents. `sqlite-async-operation-store.ts`
 * subtracts `TERMINAL_STATUSES` from this to build the positive, sargable `status IN (...)`
 * predicate its claim/reconcile queries need in place of `status NOT IN (...)`.
 */
export const ASYNC_OPERATION_STATUSES: readonly AsyncOperationStatus[] = Object.keys(
  ALLOWED_TRANSITIONS,
) as AsyncOperationStatus[];

/**
 * The complete set of key names an operation `state` object may carry, at any depth — this
 * package's own `PollingVendorAdapter`s' resumption handles (currently only `jobId`; see
 * `providers/imagerouter-video-async.ts`), never anything a `RequestSigner` needs.
 *
 * This is deliberately an allowlist, not a denylist. A denylist of "known credential-shaped
 * names" was tried first (`apiKey`, `authorization`, `secret`, ...) and it missed `clientSecret` /
 * `client_secret` on the very first adapter shape that could plausibly return one — and it can
 * never be complete, because the set of names a vendor's response body (and the adapter written
 * against it) might use for a credential is unbounded and outside this package's control. An
 * allowlist inverts the failure mode: it fails *closed*. A legitimate new field an adapter starts
 * returning is a loud registration error here — extend this set, deliberately, one entry at a
 * time — never a silent path for a secret to become durable under a name this file never
 * anticipated.
 */
const ALLOWED_STATE_KEYS: ReadonlySet<string> = new Set(['jobId']);

/**
 * Depth bound for `assertNoCredentialMaterial`'s walk. A cyclic or pathologically nested `state`
 * object must not hang the check forever, but the bound must fail *closed*: a key past this depth
 * is refused outright (see the walk in `assertNoCredentialMaterial`), not silently skipped — a
 * silent skip would let a key nested past this depth carry credential material undetected.
 */
const MAX_STATE_DEPTH = 12;

export const CREDENTIAL_IN_STATE_MESSAGE =
  'async operation state must never carry credential material — credentials are re-resolved per poll tick through the signer seam';

export interface AsyncOperationError {
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
}

/** The generated bytes, held base64-encoded so the row stays JSON-serializable for a durable adapter. */
export interface AsyncOperationResult {
  readonly bytesBase64: string;
  readonly providerNote: string;
  readonly suggestedExt?: string;
}

export interface AsyncOperationRecord {
  /** Shape discriminator — see `ASYNC_OPERATION_SCHEMA_VERSION`. Stamped once at create and never rewritten. */
  readonly schemaVersion: number;
  readonly id: string;
  readonly providerId: string;
  readonly routeKey: string;
  /** Opaque host-supplied scoping key (a run id, a workspace id) — never a domain noun this package knows. */
  readonly ownerRef: string;
  readonly status: AsyncOperationStatus;
  readonly attempts: number;
  /** Bound 1: caps a vendor that answers "pending" forever. */
  readonly maxAttempts: number;
  /** Absolute epoch ms after which this operation may not be polled again. Bound 2: caps a vendor that stops answering. */
  readonly deadlineAt: number;
  readonly nextPollAt: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  /** The vendor's resumption handle. Never credential material — see `CREDENTIAL_IN_STATE_MESSAGE`. */
  readonly state: Readonly<Record<string, unknown>> | null;
  readonly result: AsyncOperationResult | null;
  readonly error: AsyncOperationError | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AsyncOperationCreateInput {
  readonly id: string;
  readonly providerId: string;
  readonly routeKey: string;
  readonly ownerRef: string;
  readonly maxAttempts: number;
  readonly deadlineAt: number;
  readonly nextPollAt?: number;
  readonly status?: AsyncOperationStatus;
  readonly state?: Readonly<Record<string, unknown>> | null;
}

export interface AsyncOperationPatch {
  readonly status?: AsyncOperationStatus;
  readonly attempts?: number;
  readonly nextPollAt?: number;
  readonly state?: Readonly<Record<string, unknown>> | null;
  readonly result?: AsyncOperationResult | null;
  readonly error?: AsyncOperationError | null;
  readonly leaseOwner?: string | null;
  readonly leaseExpiresAt?: number | null;
}

export interface AsyncOperationUpdateOptions {
  /**
   * Fences the write to a specific lease, the same way `releaseLease` fences its own write: the
   * patch is applied only while the row's current `leaseOwner` still equals this value. Omit for
   * writes that happen outside a lease (e.g. `startOperation`'s pre-claim persistence) — those
   * apply unconditionally, as before.
   *
   * Without this, a worker whose lease expired and was reclaimed by another worker can still
   * overwrite whatever that newer owner has since written (`update` took no ownership check at
   * all), breaking the single-worker guarantee `claimDue` exists to provide. A mismatched fence is
   * a no-op, not an error — the caller's write intent is stale, not wrong — and the row is
   * returned unchanged.
   */
  readonly leaseOwner?: string;
}

export interface AsyncOperationClaimOptions {
  readonly now: number;
  readonly leaseOwner: string;
  readonly leaseMs: number;
  readonly limit?: number;
}

export interface AsyncOperationReconcileResult {
  /** Rows whose worker died holding a lease — released for another worker, status untouched. */
  readonly leasesReleased: number;
  /** Rows that blew their absolute deadline while unattended — moved to `unknown`, never to `failed`. */
  readonly deadlineExpired: number;
}

export interface AsyncOperationStore {
  create(input: AsyncOperationCreateInput): Promise<AsyncOperationRecord>;
  get(id: string): Promise<AsyncOperationRecord | null>;
  /**
   * Applies `patch`. Pass `options.leaseOwner` to fence the write to a lease the caller believes it
   * holds — see `AsyncOperationUpdateOptions`. Omitted, the write applies unconditionally (the
   * pre-lease case, e.g. `startOperation`'s initial persistence).
   */
  update(id: string, patch: AsyncOperationPatch, options?: AsyncOperationUpdateOptions): Promise<AsyncOperationRecord | null>;
  listByOwner(ownerRef: string): Promise<AsyncOperationRecord[]>;
  /** Atomically leases every due, unleased, non-terminal operation and returns the leased rows. */
  claimDue(options: AsyncOperationClaimOptions): Promise<AsyncOperationRecord[]>;
  /**
   * Releases a lease this caller believes it holds. Fenced on `leaseOwner`: a release only takes
   * effect while the row's current `leaseOwner` still equals the one passed here (the equivalent
   * SQL is a conditional `UPDATE ... WHERE id = ? AND lease_owner = ?`). Without this fence, a
   * worker that outlives its own lease (e.g. a slow poll past `leaseMs`) can clear whichever
   * worker legitimately reclaimed the row after it expired, breaking the single-worker guarantee
   * `claimDue` exists to provide. A release for a row the caller no longer owns — because it
   * never claimed it, or another worker has since reclaimed it — is a no-op, not an error: the
   * caller's intent ("I'm done, let someone else have it") is already satisfied either way.
   */
  releaseLease(id: string, leaseOwner: string): Promise<void>;
  /**
   * Boot-time recovery. Unlike `MediaTaskStore.reconcileOnBoot`, this does NOT terminate in-flight
   * work: a vendor-side job outlives our process, so the row stays pollable and only its dead
   * lease is cleared. Rows already past their absolute deadline go to `unknown` — never `failed`,
   * because an unattended deadline says nothing about whether the vendor did the work.
   */
  reconcileOnBoot(options: { now: number }): Promise<AsyncOperationReconcileResult>;
}

/**
 * Rejects anything in an operation `state` object outside the resumption-handle allowlist —
 * which, as a consequence, rejects credential material regardless of what key name it arrives
 * under (see `ALLOWED_STATE_KEYS`).
 *
 * @throws `Error` (message starts with `CREDENTIAL_IN_STATE_MESSAGE`, naming the offending key)
 *   when any key at any depth is not in `ALLOWED_STATE_KEYS`.
 * @complexity O(n) in the total number of keys, bounded by `MAX_STATE_DEPTH` against a cyclic or
 *   pathologically nested object.
 */
export function assertNoCredentialMaterial(state: Readonly<Record<string, unknown>> | null | undefined): void {
  if (state == null) return;
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object') return;
    if (depth > MAX_STATE_DEPTH) {
      throw new Error(
        `${CREDENTIAL_IN_STATE_MESSAGE} (state nesting exceeds ${MAX_STATE_DEPTH} levels — this allowlist cannot verify keys past that depth, so the object is rejected outright rather than silently accepted)`,
      );
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!ALLOWED_STATE_KEYS.has(key)) {
        throw new Error(
          `${CREDENTIAL_IN_STATE_MESSAGE} (key "${key}" is not in the resumption-handle allowlist — add it there if it is genuinely not credential material)`,
        );
      }
      walk(entry, depth + 1);
    }
  };
  walk(state, 0);
}

/**
 * The branching read path for a persisted operation row.
 *
 * A durable adapter calls this on every row it loads. A row with no discriminator predates
 * versioning (v0) and is upgraded in place on read; a row from a newer build is refused loudly
 * rather than misread, because silently reinterpreting an unknown shape is how a stored operation
 * becomes a duplicate vendor charge.
 *
 * @throws When `schemaVersion` is newer than this build understands.
 * @complexity O(1).
 */
export function hydrateAsyncOperationRecord(raw: Record<string, unknown>): AsyncOperationRecord {
  const stored = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (stored > ASYNC_OPERATION_SCHEMA_VERSION) {
    throw new Error(
      `async operation row was written at schema version ${stored}, newer than this build understands (${ASYNC_OPERATION_SCHEMA_VERSION}) — upgrade rather than risk misreading it`,
    );
  }
  // v0 -> v1 added only the discriminator itself, so the upgrade is a stamp. A later version adds
  // its own branch here; the row is never rewritten on disk just to be readable.
  const now = Date.now();
  return {
    schemaVersion: ASYNC_OPERATION_SCHEMA_VERSION,
    id: String(raw.id),
    providerId: String(raw.providerId),
    routeKey: String(raw.routeKey),
    ownerRef: String(raw.ownerRef),
    status: (raw.status as AsyncOperationStatus | undefined) ?? 'submitted',
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
    maxAttempts: Number(raw.maxAttempts),
    deadlineAt: Number(raw.deadlineAt),
    nextPollAt: typeof raw.nextPollAt === 'number' ? raw.nextPollAt : now,
    leaseOwner: (raw.leaseOwner as string | null | undefined) ?? null,
    leaseExpiresAt: (raw.leaseExpiresAt as number | null | undefined) ?? null,
    state: (raw.state as Readonly<Record<string, unknown>> | null | undefined) ?? null,
    result: (raw.result as AsyncOperationResult | null | undefined) ?? null,
    error: (raw.error as AsyncOperationError | null | undefined) ?? null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

function cloneRecord(row: AsyncOperationRecord): AsyncOperationRecord {
  return {
    ...row,
    state: row.state === null ? null : structuredClone(row.state),
    result: row.result === null ? null : { ...row.result },
    error: row.error === null ? null : { ...row.error },
  };
}

/** Exported for the same reason as `TERMINAL_STATUSES` — see its doc. */
export function assertTransition(from: AsyncOperationStatus, to: AsyncOperationStatus): void {
  if (!ALLOWED_TRANSITIONS[from]) {
    throw new RangeError(`Invalid async operation status: "${from}"`);
  }
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new RangeError(`Invalid async operation transition: "${from}" -> "${to}"`);
  }
}

/**
 * Creates the in-memory reference `AsyncOperationStore`. No persistence — a durable adapter
 * implements the same interface; every method here is written so the equivalent SQL is a direct
 * translation (`claimDue` in particular is a single conditional UPDATE ... RETURNING).
 */
export function createInMemoryAsyncOperationStore(): AsyncOperationStore {
  const rows = new Map<string, AsyncOperationRecord>();

  const requireRow = (id: string): AsyncOperationRecord | undefined => rows.get(id);

  return {
    async create(input: AsyncOperationCreateInput): Promise<AsyncOperationRecord> {
      if (rows.has(input.id)) {
        throw new Error(`async operation "${input.id}" already exists`);
      }
      if (!Number.isFinite(input.maxAttempts) || input.maxAttempts < 1) {
        throw new RangeError(`Invalid maxAttempts: ${input.maxAttempts} must be a finite number >= 1`);
      }
      if (!Number.isFinite(input.deadlineAt)) {
        throw new RangeError(`Invalid deadlineAt: ${input.deadlineAt} must be a finite epoch-ms timestamp`);
      }
      assertNoCredentialMaterial(input.state);

      const now = Date.now();
      const row: AsyncOperationRecord = {
        schemaVersion: ASYNC_OPERATION_SCHEMA_VERSION,
        id: input.id,
        providerId: input.providerId,
        routeKey: input.routeKey,
        ownerRef: input.ownerRef,
        status: input.status ?? 'submitted',
        attempts: 0,
        maxAttempts: input.maxAttempts,
        deadlineAt: input.deadlineAt,
        nextPollAt: input.nextPollAt ?? now,
        leaseOwner: null,
        leaseExpiresAt: null,
        state: input.state === undefined || input.state === null ? null : structuredClone(input.state),
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return cloneRecord(row);
    },

    async get(id: string): Promise<AsyncOperationRecord | null> {
      const row = requireRow(id);
      return row ? cloneRecord(row) : null;
    },

    async update(id: string, patch: AsyncOperationPatch, options?: AsyncOperationUpdateOptions): Promise<AsyncOperationRecord | null> {
      const existing = requireRow(id);
      if (!existing) return null;
      // Fenced, like releaseLease: a caller writing against a lease it no longer holds gets a
      // no-op, not an overwrite of whoever holds (or now holds none of) it.
      if (options?.leaseOwner !== undefined && existing.leaseOwner !== options.leaseOwner) {
        return cloneRecord(existing);
      }
      if ('state' in patch) assertNoCredentialMaterial(patch.state);

      const status = patch.status ?? existing.status;
      assertTransition(existing.status, status);

      const next: AsyncOperationRecord = {
        ...existing,
        schemaVersion: existing.schemaVersion,
        status,
        attempts: patch.attempts ?? existing.attempts,
        nextPollAt: patch.nextPollAt ?? existing.nextPollAt,
        state: 'state' in patch ? (patch.state == null ? null : structuredClone(patch.state)) : existing.state,
        result: 'result' in patch ? (patch.result ?? null) : existing.result,
        error: 'error' in patch ? (patch.error ?? null) : existing.error,
        leaseOwner: 'leaseOwner' in patch ? (patch.leaseOwner ?? null) : existing.leaseOwner,
        leaseExpiresAt: 'leaseExpiresAt' in patch ? (patch.leaseExpiresAt ?? null) : existing.leaseExpiresAt,
        updatedAt: Date.now(),
      };
      rows.set(id, next);
      return cloneRecord(next);
    },

    async listByOwner(ownerRef: string): Promise<AsyncOperationRecord[]> {
      return [...rows.values()]
        .filter((row) => row.ownerRef === ownerRef)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(cloneRecord);
    },

    async claimDue(options: AsyncOperationClaimOptions): Promise<AsyncOperationRecord[]> {
      const { now, leaseOwner, leaseMs } = options;
      const limit = options.limit ?? 10;
      const claimed: AsyncOperationRecord[] = [];

      for (const row of [...rows.values()].sort((a, b) => a.nextPollAt - b.nextPollAt)) {
        if (claimed.length >= limit) break;
        if (TERMINAL_STATUSES.has(row.status)) continue;
        if (row.nextPollAt > now) continue;
        // A live lease held by anyone (including this worker's previous tick) blocks the claim;
        // an expired one does not, which is what makes a dead worker's rows recoverable.
        if (row.leaseExpiresAt !== null && row.leaseExpiresAt > now) continue;

        const leased: AsyncOperationRecord = {
          ...row,
          leaseOwner,
          leaseExpiresAt: now + leaseMs,
          updatedAt: now,
        };
        rows.set(row.id, leased);
        claimed.push(cloneRecord(leased));
      }
      return claimed;
    },

    async releaseLease(id: string, leaseOwner: string): Promise<void> {
      const row = requireRow(id);
      if (!row) return;
      // Fenced: a stale owner's late release must not clear a lease another worker has since
      // legitimately reclaimed. See the interface doc for why this is not merely defensive.
      if (row.leaseOwner !== leaseOwner) return;
      rows.set(id, { ...row, leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() });
    },

    async reconcileOnBoot(options: { now: number }): Promise<AsyncOperationReconcileResult> {
      const { now } = options;
      let leasesReleased = 0;
      let deadlineExpired = 0;

      for (const row of [...rows.values()]) {
        if (TERMINAL_STATUSES.has(row.status)) continue;

        if (row.deadlineAt <= now) {
          rows.set(row.id, {
            ...row,
            status: 'unknown',
            leaseOwner: null,
            leaseExpiresAt: null,
            error: {
              message: 'async operation passed its absolute deadline while unattended — vendor-side effect is undetermined',
              code: 'DEADLINE_EXPIRED',
            },
            updatedAt: now,
          });
          deadlineExpired += 1;
          continue;
        }

        if (row.leaseOwner !== null && (row.leaseExpiresAt === null || row.leaseExpiresAt <= now)) {
          rows.set(row.id, { ...row, leaseOwner: null, leaseExpiresAt: null, updatedAt: now });
          leasesReleased += 1;
        }
      }
      return { leasesReleased, deadlineExpired };
    },
  };
}

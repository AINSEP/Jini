import type {
  ClockPort,
  DomainEvent,
  IdGeneratorPort,
  JsonObject,
  OutboxPort,
  UUID,
} from "../ports.js";
import type { ChangeSetOperation, ChangeSetRepoPort } from "./change-set.js";

/**
 * @file The single mutation write path.
 *
 * Purpose:
 * Every admin mutation — human save or AI tool call — runs through
 * `executeCommand`, which captures the inverse, executes the feature call, and
 * records an auto-applied single-item change set. Audit trail by construction.
 *
 * How it relates to the project:
 * - Wraps `features/*` mutation functions; never contains domain logic itself.
 * - Persists via `ChangeSetRepoPort`; announces via the outbox when provided.
 * - `revert.ts` consumes the recorded inverse payloads to undo change sets.
 *
 * Architectural role:
 * The gate that makes "auditable and undoable" a property of the system rather
 * than a per-feature effort. Proposed (unapplied) multi-item change sets for
 * agent plans build on this same envelope later.
 */

/** Principal executing a command. Agents act on behalf of a user. */
export interface CommandActor {
  id: UUID;
  kind: "user" | "agent";
  /** User the agent is acting for; unset for direct human commands. */
  onBehalfOfId?: UUID | undefined;
}

/** Cross-cutting command metadata; the mutation itself lives in `CommandMutation`. */
export interface CommandEnvelope {
  workspaceId: UUID;
  actor: CommandActor;
  /** Human-readable description recorded on the change set. */
  summary: string;
  /** Supplied by retry-capable callers (agents must always send one). */
  idempotencyKey?: string | undefined;
  /** Chat message / plan step that motivated this command. */
  intentRef?: string | undefined;
  /**
   * The permission this mutation requires, e.g.
   * `"content.write"`. Must be supplied together with `ExecuteCommandDeps.authorize`
   * — see that field's doc for the migration story. Optional only so gateway
   * callers not yet migrated to real identity/authorize wiring keep compiling.
   */
  permission?: string | undefined;
}

/** The entity write a command performs, with its inverse capture. */
export interface CommandMutation<TResult> {
  entityType: string;
  entityId: UUID;
  operation: ChangeSetOperation;
  /**
   * Snapshot whatever is needed to undo this mutation, read *before* execute.
   * Return null when no inverse exists — the change set is then recorded but
   * cannot be reverted (and agents must not be offered this mutation).
   */
  captureInverse(): Promise<JsonObject | null>;
  /** The actual feature call. Runs only after inverse capture succeeds. */
  execute(): Promise<TResult>;
  /**
   * Read the entity's version from the execute result (the version *after* the
   * mutation, REQ-08 / AC-02). Stamped onto the item as the revert guard input.
   * Omit for entity types without a version.
   */
  captureEntityVersion?(result: TResult): number | null;
  /**
   * Compensating rollback for the memory adapter's all-or-nothing guarantee
   * (REQ-01 / BR-04 / EC-08 / AC-17). If the change-set record fails to persist
   * *after* `execute()` has applied the feature mutation, the gateway calls this
   * to undo the mutation — restoring the entity to its exact pre-`execute` state
   * (verbatim, including `version`) so no "mutation without a record" survives
   * (INV-01). On the SQLite adapter (RT-004) a real transaction replaces this and
   * `rollback` becomes a no-op/omitted. Omit only for a mutation whose record step
   * cannot fail independently of its feature write (none in v1).
   */
  rollback?(): Promise<void>;
}

/**
 * The shape of the `authorize()` gate, kept generic here so
 * `core/commands` never imports the `identity` library (that would invert the
 * dependency direction — `features`/libraries depend on `core`, not the
 * reverse; see `identity/authorize.ts`'s file header). Composition roots
 * (`server/app.ts` / `server/deps.ts`) bind a closure over the real
 * `identity.authorize()` and its repos, and pass that closure as
 * `ExecuteCommandDeps.authorize`.
 */
export type AuthorizeFn = (params: {
  principalId: UUID;
  permission: string;
  workspaceId: UUID;
  entityType?: string | undefined;
  entityId?: UUID | undefined;
}) => Promise<{ allowed: boolean; reason: string }>;

/** Dependencies for executeCommand. */
export interface ExecuteCommandDeps {
  clock: ClockPort;
  idGen: IdGeneratorPort;
  changeSets: ChangeSetRepoPort;
  /** When provided, `change-set.applied` is enqueued for async consumers. */
  outbox?: OutboxPort | undefined;
  /**
   * Authorization gate. Must be supplied together with
   * `CommandEnvelope.permission` — omitting one while supplying the other is a
   * wiring bug (see `executeCommand`'s guard) rather than something that
   * should silently allow or silently skip. Omitting BOTH is the legacy
   * pre-identity path, kept so gateway callers not yet migrated to real
   * identity/authorize wiring keep compiling and passing (see the Programmer
   * handoff for which routes remain unconverted this pass).
   */
  authorize?: AuthorizeFn | undefined;
}

/** Required parameters for executeCommand. */
export interface ExecuteCommandRequired<TResult> {
  deps: ExecuteCommandDeps;
  command: CommandEnvelope;
  mutation: CommandMutation<TResult>;
}

/** Optional parameters for executeCommand. Reserved for future use. */
export interface ExecuteCommandOptional {}

/**
 * Thrown when a command's idempotency key was already used in the workspace.
 * Callers should re-read current state instead of retrying the mutation.
 */
export class DuplicateCommandError extends Error {
  readonly changeSetId: UUID;

  constructor(message: string, changeSetId: UUID) {
    super(message);
    this.changeSetId = changeSetId;
  }
}

/**
 * Thrown when `authorize()` denies the caller. Routes map
 * this to 403 `FORBIDDEN`. Raised before the idempotency check (INV-04) — a
 * replayed command id from a denied caller therefore never produces
 * `DuplicateCommandError` either (EC-08).
 */
export class ForbiddenError extends Error {
  readonly permission: string;
  readonly reason: string;

  constructor(message: string, permission: string, reason: string) {
    super(message);
    this.permission = permission;
    this.reason = reason;
  }
}

/**
 * Execute a mutation through the command gateway.
 *
 * Order matters: idempotency check → inverse capture → execute → record.
 * If execute throws, nothing is recorded; if inverse capture throws, the
 * mutation never runs.
 *
 * The feature mutation and its change-set record commit as one unit of work
 * (REQ-01): if `changeSets.insert` fails after `execute` has applied the
 * mutation, the gateway rolls the mutation back via `mutation.rollback` and
 * re-throws, so no change set and no outbox event survive (EC-08 / AC-17,
 * INV-01).
 *
 * The `change-set.applied` event is passed as `changeSets.insert()`'s third argument, not a
 * separate `deps.outbox.enqueue()` call afterward — a durable adapter co-persists it inside the
 * same transaction as the change-set record, so it can never land without a durable delivery
 * record (or vice versa). This still does NOT cover the domain mutation itself
 * (`mutation.execute()` stays outside any shared transaction, covered only by the compensating
 * rollback above), and it covers only this producer. See
 * `docs/decisions/change-set-outbox-transaction-boundary.md` for the full rationale, including the
 * other direct `OutboxPort.enqueue()` producers this decision deliberately leaves untouched.
 */
export async function executeCommand<TResult>(
  required: ExecuteCommandRequired<TResult>,
  _optional: ExecuteCommandOptional = {}
): Promise<{ result: TResult; changeSetId: UUID }> {
  const { deps, command, mutation } = required;

  // authorize() runs BEFORE the idempotency check, so
  // a denied caller never learns whether a replayed command id previously
  // succeeded (no DUPLICATE_COMMAND / changeSetId leak, EC-08). `permission`
  // and `authorize` are wired together or not at all (see ExecuteCommandDeps
  // doc) — partial wiring is a programming error, not a silent allow/skip.
  if (Boolean(deps.authorize) !== Boolean(command.permission)) {
    throw new Error(
      "executeCommand: command.permission and deps.authorize must be supplied together " +
        "— partial wiring would silently skip or misapply authorization"
    );
  }
  if (deps.authorize && command.permission) {
    const authResult = await deps.authorize({
      principalId: command.actor.id,
      permission: command.permission,
      workspaceId: command.workspaceId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
    });
    if (!authResult.allowed) {
      throw new ForbiddenError(
        `principal '${command.actor.id}' is not authorized for '${command.permission}' (${authResult.reason})`,
        command.permission,
        authResult.reason
      );
    }
  }

  if (command.idempotencyKey) {
    const existing = await deps.changeSets.findByIdempotencyKey({
      workspaceId: command.workspaceId,
      idempotencyKey: command.idempotencyKey,
    });
    if (existing) {
      throw new DuplicateCommandError(
        `command with idempotency key '${command.idempotencyKey}' was already executed`,
        existing.id
      );
    }
  }

  const inversePayload = await mutation.captureInverse();
  const result = await mutation.execute();

  const entityVersionAtApply = mutation.captureEntityVersion?.(result) ?? undefined;

  const now = deps.clock.nowIso();
  const changeSetId = deps.idGen.newId();

  // BR-04: the event rides into insert()'s third argument (see this function's doc comment) so a
  // durable adapter co-persists it atomically with the record it belongs to. Built unconditionally
  // (cheap, pure data) but only passed through when an outbox is actually wired.
  const event: DomainEvent<{ changeSetId: UUID; entityType: string; entityId: UUID }> = {
    id: deps.idGen.newId(),
    name: "change-set.applied",
    occurredAt: now,
    aggregateId: changeSetId,
    workspaceId: command.workspaceId,
    actorId: command.actor.id,
    changeSetId,
    payload: {
      changeSetId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
    },
  };

  // Unit of work: the change-set record (and, when an outbox is wired, its delivery event) must
  // land together, or the feature mutation is rolled back (REQ-01 / EC-08). On the in-memory
  // adapter this is a compensating restore via `mutation.rollback`; the SQLite adapter does this
  // as one real transaction and the rollback becomes a no-op for this step.
  try {
    await deps.changeSets.insert(
      {
        id: changeSetId,
        workspaceId: command.workspaceId,
        actorId: command.actor.id,
        status: "applied",
        summary: command.summary,
        idempotencyKey: command.idempotencyKey,
        intentRef: command.intentRef,
        createdAt: now,
        appliedAt: now,
      },
      [
        {
          id: deps.idGen.newId(),
          changeSetId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          operation: mutation.operation,
          inversePayload: inversePayload ?? undefined,
          entityVersionAtApply,
          position: 0,
        },
      ],
      deps.outbox ? event : undefined
    );
  } catch (recordError) {
    // AC-17 / EC-08: the mutation applied but its record did not. Undo the
    // mutation so INV-01 holds (no mutation without a record). We surface the
    // original persist error; a rollback that itself throws is a harder failure
    // that the SQLite transaction path is designed to remove.
    await mutation.rollback?.();
    throw recordError;
  }

  return { result, changeSetId };
}

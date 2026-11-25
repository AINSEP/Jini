import type { Clock, IdGenerator, JsonObject, UUID } from "../../primitives/index.js";
import type { ChangeSetItemRecord, ChangeSetOperation, ChangeSetRecord, ChangeSetRepoPort } from "./change-set.js";
import type { DomainEvent, MutationActor, OutboxPort } from "./ports.js";

/**
 * Principal executing a command. Agents act on behalf of a user.
 * A `MutationActor` narrowed to the kinds that run commands, plus the delegation field.
 */
export interface CommandActor extends MutationActor {
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
   * mutation). Stamped onto the item as the revert guard input.
   * Omit for entity types without a version.
 * See docs/decisions/DR-006-mutation-audit-atomicity.md.
 */
  captureEntityVersion?(required: { result: TResult }, optional?: Record<string, never>): number | null;
  /**
   * Compensating rollback for the memory adapter's all-or-nothing guarantee
   * If version capture, record preparation or persistence fails
   * *after* `execute` has applied the feature mutation, the gateway calls this
   * to undo the mutation — restoring the entity to its exact pre-`execute` state
   * (verbatim, including `version`) so no "mutation without a record" survives
   * On the SQLite adapter a real transaction replaces this and
   * `rollback` may be a no-op/omitted only when a caller-owned transaction covers
   * the feature write AND all subsequent record preparation/persistence. The gateway
   * opens no such transaction itself. Without rollback or that outer transaction, a
   * post-mutation failure rejects but leaves the feature mutation applied (
   * is not guaranteed). A rollback rejection takes precedence over the original error.
 * See docs/decisions/DR-006-mutation-audit-atomicity.md.
 */
  rollback?(): Promise<void>;
}

/**
 * The shape of the `authorize()` gate, kept generic here so
 * `core/commands` never imports the `identity` library (that would invert the
 * dependency direction — `features`/libraries depend on `core`, not the
 * reverse; see `packages/user-management/src/server/authorize.ts`'s file header). Composition roots
 * (the host's composition root) bind a closure over the real
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
  clock: Clock;
  idGen: IdGenerator;
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

/** The audited write gateway's shape; cms implements it (`executeCommand`), consumers take it injected. */
export type ExecuteCommandFn = <TResult>(
  required: ExecuteCommandRequired<TResult>,
  optional?: ExecuteCommandOptional,
) => Promise<{ result: TResult; changeSetId: UUID }>;

/** Forms persistence and outbound effect contracts. Concrete repositories, HTTP routing, tool wiring and transport implementations belong to consumers. */
import type { UUID } from "@jini-ai/core/primitives";
import type { FormDefinitionRecord, FormSubmissionPage, FormSubmissionRecord } from "./types.js";

/** Definitions and submissions have distinct lifecycles and therefore separate ports.
 * Deletion belongs to the host's Trash/purge workflow, so neither persistence port exposes delete.
 * Reads must hide trashed rows at the repository boundary: public submitters, widget resolvers
 * and other direct consumers must get not-found even if they forget an additional domain filter. */
export interface FormDefinitionRepoPort {
  /** Reads and updates expose only live records; a trashed row still reserves its slug. */
  findById(required: { workspaceId: UUID; id: UUID }): Promise<FormDefinitionRecord | null>;

  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<FormDefinitionRecord | null>;

  list(required: { workspaceId: UUID }): Promise<FormDefinitionRecord[]>;

  /** The database unique index is the tie-break for (workspaceId, slug); callers translate collisions.
   * A trashed row retains its slug so restoring it is lossless, and can therefore still conflict. */
  create(record: FormDefinitionRecord): Promise<void>;

  /** Update only a live row, affecting zero rows if it was trashed meanwhile. Only Trash restore
   * may revive it. Keep create/update separate so genuine insert uniqueness races remain visible. */
  update(record: FormDefinitionRecord): Promise<void>;

  /** Deliberately trash-blind: both live and trashed rows reserve a slug. Duplication must not
   * propose a trashed slug as available and then collide with the database unique index. */
  isSlugTaken(required: { workspaceId: UUID; slug: string }): Promise<boolean>;
}

export interface FormSubmissionRepoPort {
  // Hide trashed submissions too; removal is a host Trash effect, and only purge removes them permanently.
  findById(required: { workspaceId: UUID; id: UUID }): Promise<FormSubmissionRecord | null>;
  create(record: FormSubmissionRecord): Promise<void>;
  /** Optional repository-owned transaction. Hosts may instead bind a wider unit of work. */
  transaction?: SubmissionTransactionPort;

  /** Newest first, submittedAt descending then id descending for ties. The opaque cursor resumes
   * after the last returned row; callers validate limit (1..100) before reaching persistence. */
  listByDefinition(required: {
    workspaceId: UUID;
    formDefinitionId: UUID;
    limit: number;
  }, optional?: { cursor?: string | null }): Promise<FormSubmissionPage>;
}

export interface RateLimiterPort {
  check(required: { key: string }): { allowed: true } | { allowed: false; retryAfterSeconds: number } | Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
}
export interface FormOutboxPort { enqueue(event: import("../core/index.js").DomainEvent): Promise<void>; }
/**
 * Runs `work` as one unit of persistence: commit when it resolves, roll back when it throws. A host
 * binds its database transaction here so an accepted submission's row and its outbox event are
 * written together; a submission stored without its event would never notify anyone.
 */
export type SubmissionTransactionPort = <T>(work: () => Promise<T>) => Promise<T>;
/** Bound to the host's outbox/bus/clock; dispatch is kicked off without awaiting delivery. */
export interface OutboxDispatcherPort { dispatch(required: Record<string, never>): Promise<void>; }
export interface EmailAddress { email: string; name?: string; }
export interface OutboundEmail { workspaceId: UUID; to: EmailAddress; from: EmailAddress; subject: string; text: string; }
export interface MailerSendOptions {
  idempotencyKey: string;
  workspaceId: UUID;
  sourceContext: { module: string; ref: string };
  purpose: "transactional";
  lane: "notification";
}
export type MailerSendResult = { ok: true; providerMessageId: string; acceptedAt: string } | { ok: false; retryable: boolean; errorCode: string; message: string };
export interface MailerPort { send(required: { message: OutboundEmail; options: MailerSendOptions }): Promise<MailerSendResult>; }

/** Generic audited mutation contract supplied by the host composition root. */
export type FormCommandExecutorPort = typeof import("../core/index.js").executeCommand;

/** Authoring stays behind a port so the universal write service never loads an HTML parser. */
export interface FormAuthoringPort {
  prepare(required: {
    deps: Pick<import("./write-service.js").FormWriteServiceDeps, "authorize">;
    input: import("./fields-json.js").FormAuthoring & { workspaceId: string; actor: { id: string } };
    existing?: import("./fields-json.js").HtmlFormDefinitionRecord;
  }, optional?: Record<string, never>): Promise<(import("./fields-json.js").FormAuthoring & { fields?: FormDefinitionRecord["fields"] }) | undefined>;
  with(required: {
    repo: FormDefinitionRepoPort;
    authoring: import("./fields-json.js").FormAuthoring & { fields?: FormDefinitionRecord["fields"] };
  }, optional?: { replaceFields?: boolean }): FormDefinitionRepoPort;
}

/** A submission-only view; never changes the durable definition's descriptors. */
export type FormDefinitionViewPort = (
  required: { definition: FormDefinitionRecord; body: Record<string, unknown> },
  optional?: Record<string, never>,
) => FormDefinitionRecord;

/** Host-bound Trash removal; only the host's purge lifecycle permanently deletes rows. */
export type RemoveFormSubmissionFn = (required: {
  workspaceId: UUID;
  id: UUID;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;

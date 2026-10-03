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
export interface FormOutboxPort { enqueue(event: import("@jini-ai/cms/core").DomainEvent): Promise<void>; }
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
export type FormCommandExecutorPort = typeof import("@jini-ai/cms/core").executeCommand;

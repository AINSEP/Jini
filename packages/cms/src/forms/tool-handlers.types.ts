/**
 * @file The ports and the deps type the Forms tool handlers are written against. The handlers read
 * only what is declared here, so the host supplies every policy value (the audited write wrappers,
 * the slug rule, the duplicate-name search) rather than the handlers importing it.
 */
import type { AuthorizeFn, ChangeSetRepoPort, OutboxPort } from "@jini-ai/core/contracts/events";
import type { Clock, IdGenerator } from "@jini-ai/core/primitives";
import type { CreateFormDefinitionRequired, FormWriteServiceDeps, SetFormDefinitionStatusRequired, UpdateFormDefinitionRequired } from "./write-service.js";
import type { FormCollectionRegistry } from "../core/form-collection.js";
import type { FormCommandExecutorPort, FormDefinitionRepoPort, FormSubmissionRepoPort } from "./ports.js";
import type { FormDefinitionRecord, NotifyConfig } from "./types.js";
import type { FormDeliveryJobStatus } from "./delivery/status.js";

/** The gateway dependencies of one form-definition write, before the host binds its policy. */
export interface FormsToolWriteDeps extends Omit<FormWriteServiceDeps, "permission" | "reservedSlugs"> {
  outbox?: OutboxPort;
}

/** The host's audited form-definition writes: each binds the permission and reserved-slug policy. */
export interface FormsWriteOps {
  create(required: {
    deps: FormsToolWriteDeps;
    input: CreateFormDefinitionRequired["input"] & { notify?: NotifyConfig | undefined; idempotencyKey?: string };
  }): Promise<{ definition: FormDefinitionRecord }>;
  update(
    required: { deps: FormsToolWriteDeps; input: UpdateFormDefinitionRequired["input"] & { idempotencyKey?: string } },
    optional?: { expectedVersion?: number },
  ): Promise<{ definition: FormDefinitionRecord }>;
  setStatus(required: {
    deps: FormsToolWriteDeps;
    input: SetFormDefinitionStatusRequired["input"] & { idempotencyKey?: string };
  }): Promise<{ definition: FormDefinitionRecord }>;
}

/** How a duplicate's slug is derived from its name: the host's slugger, attempt cap and reserved slugs. */
export interface FormsSlugPolicy {
  slugify(text: string): string;
  maxAttempts: number;
  reservedSlugs: ReadonlySet<string>;
}

/** The numeric-suffix name search the host owns, passed in so the handlers do not import it. */
export type DeriveDuplicateName = (
  required: { sourceName: string },
  options: { isTaken: (required: { candidate: string }, optional?: Record<string, never>) => Promise<boolean> },
) => Promise<string>;

/** One binding's delivery of one submission: status derived from its outbox job, nothing else. */
export type FormsToolDeliveryStatusRow = {
  readonly bindingId: string;
  readonly adapterId: string;
  readonly formId: string;
  readonly submissionId: string;
} & FormDeliveryJobStatus;

/** The delivery-status reads `forms_delivery_status` calls; both are scoped to `workspaceId`. */
export interface FormsToolDeliveryStatusPort {
  forSubmission(required: { workspaceId: string; submissionId: string }, optional?: Record<string, never>): Promise<readonly FormsToolDeliveryStatusRow[]>;
  recentUnfinished(required: { workspaceId: string }, optional?: { limit?: number }): Promise<readonly FormsToolDeliveryStatusRow[]>;
}

/** The pull `forms_pull_submissions` calls; its report is returned to the model unchanged. */
export interface FormsToolPullPort {
  pull(required: { workspaceId: string }, optional?: { targetId?: string }): Promise<unknown>;
}

/** The exact slice of the host's deps the Forms tool handlers read, plus the three host ports. */
export interface FormsPackageToolDeps {
  /** Same app-scoped collection registry as the admin provider listing. */
  formCollectionProviders?: () => FormCollectionRegistry;
  executeCommand: FormCommandExecutorPort;
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: IdGenerator;
  changeSets: ChangeSetRepoPort;
  outbox: OutboxPort;
  formDefinitionRepo: FormDefinitionRepoPort;
  formSubmissionRepo: FormSubmissionRepoPort;
  /** Absent outside the real site composition. */
  formSubmissionsPull?: FormsToolPullPort;
  /** Absent outside the real site composition. */
  formDeliveryStatus?: FormsToolDeliveryStatusPort;
  formWrites: FormsWriteOps;
  slugPolicy: FormsSlugPolicy;
  deriveDuplicateName: DeriveDuplicateName;
}

/** What every forms tool handler factory is given: the deps. */
export interface FormsHandlerArgs {
  deps: FormsPackageToolDeps;
}

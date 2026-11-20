export * from "./types.js";
export * from "./ports.js";
export * from "./errors.js";
export * from "./forms.js";
export * from "./rate-limit-key.js";
export * from "./write-service.js";
export * from "./submit-service.js";
export * from "./notify-subscriber.js";
export * from "./submission-ip-retention.js";
export * from "./fields-json.js";
export * from "./html-render.js";
export * from "./submission-attempts.js";
export * from "./submission-email-validation.js";
export * from "./delete-submission.js";
export * from "./duplicate-slug.js";
export * from "./repo.memory.js";
export * from "./field-registry.js";

export * from "./delivery/index.js";
// The optional platform peer is required only by the dedicated /forms/email-sender entry.

export * from "./attachment-purge.js";
export * from "./submission-json.js";
export * from './attachment-cleanup.js';
export * from './request-admission.js';

export * from "./provider.js";

export * from "./submission-evidence.js";

export * from "./reconcile-attachments.js";

export * from "./destination-contracts.js";
export * from "./destination-descriptors.js";

export * from "./delivery-status-limits.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for the catalog's contract). */
export { formsAgentToolCatalog } from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain. `FormsPackageToolDeps` is declared structurally, so a host
 * satisfies it with whatever it already has; the host supplies the audited write wrappers, the
 * slug rule and the duplicate-name search (see `tool-handlers.types.ts`).
 */
export { buildFormsToolRegistrations, formsDerivedRisk } from "./tool-registrations.js";
export type {
  DeriveDuplicateName,
  FormsPackageToolDeps,
  FormsSlugPolicy,
  FormsToolDeliveryStatusPort,
  FormsToolDeliveryStatusRow,
  FormsToolPullPort,
  FormsToolWriteDeps,
  FormsWriteOps,
} from "./tool-handlers.types.js";

/** `content_duplicate`'s `"form"` implementation, over the same deps as the tools. */
export { duplicateFormDefinition, type DuplicateFormRequired } from "./duplicate-form.js";

export { buildFormDestinationRegistry } from "./destination-registry.js";

export { FORM_TEXT_MAX_CHARS, FORM_LONG_TEXT_MAX_CHARS, fieldMaxChars, capSubmissionFieldLengths } from "./field-length-caps.js";

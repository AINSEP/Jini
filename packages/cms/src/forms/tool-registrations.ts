/**
 * @file Forms' half of ADR-049 Decision 4 (SPEC-010): maps `agent-tools.ts`'s five catalog entries
 * onto the three `write-service.ts` operations plus the two submission reads, as `ToolRegistration`s.
 *
 * `ToolPolicy.authorize` is a pass-through for all five (see `buildDomainRegistrations`), because
 * ADR-021 §2 is "one evaluator". For the three definition tools, `admin.forms.manage` is enforced
 * one layer down by `executeCommand` inside every one of the three write-service functions, against
 * the SAME `authorize()` the human admin routes use. For the two submission tools, there is no
 * domain service layer to inherit a gate from — `formSubmissionRepo`/`formDefinitionRepo` are read
 * directly, exactly like the host's admin submission routes — so their handlers below
 * call `requireToolPermission` explicitly, in the route's place, the same pattern
 * `comments/tool-registrations.ts` uses for `comments_list_moderation_queue`. A second check on the
 * three self-enforcing tools would be a duplicate evaluator, and a `ToolPolicy`-only check would be
 * bypassable by any future non-tool caller of the same domain function.
 */
import {
  buildDomainRegistrations,
  resolveHostReadText,
  type HostReadVocabulary,
  type AgentToolSideEffect,
  type ToolHandler,
  type ToolRegistration,
} from "@jini-ai/core";
import { versionConflictRule } from "@jini-ai/core/optimistic-concurrency";
import { forbiddenRule, withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { ForbiddenError } from "../core/commands/command.js";
import {
  FormDefinitionNotFoundError,
  FormRateLimitExceededError,
  FormSlugConflictError,
  FormSubmissionNotFoundError,
  FormSubmissionValidationError,
} from "./errors.js";
import {
  formsCatalogById,
  formsCreateDefinitionHandler,
  formsListDefinitionsHandler,
  formsListProvidersHandler,
  formsSetDefinitionStatusHandler,
  formsUpdateDefinitionHandler,
} from "./tool-handlers.definitions.js";
import {
  formsDeliveryStatusHandler,
  formsGetSubmissionHandler,
  formsListSubmissionsHandler,
  formsPullSubmissionsHandler,
} from "./tool-handlers.submissions.js";
import type { FormsPackageToolDeps } from "./tool-handlers.types.js";


/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const formsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> formDefinitionRepo.list: one unfiltered read, no write of any kind.
  ["forms_list_definitions", "none"],
  ["forms_list_providers", "none"],
  // -> createFormDefinition (write-service.ts): executeCommand -> repo.create + change-set + outbox.
  ["forms_create_definition", "mutates-durable-state"],
  // -> updateFormDefinition (write-service.ts): executeCommand -> repo.update + change-set + outbox.
  ["forms_update_definition", "mutates-durable-state"],
  // -> setFormDefinitionStatus (write-service.ts): executeCommand -> repo.update (status flip) +
  //    change-set + outbox. Never a delete: FormDefinitionRepoPort exposes no delete method — a
  //    definition is removed permanently only via a Trash purge, never through this tool (INV-08).
  ["forms_set_definition_status", "mutates-durable-state"],
  // -> formSubmissionRepo.listByDefinition: one paginated read, no write of any kind.
  ["forms_list_submissions", "none"],
  // -> formSubmissionRepo.findById: one read, no write of any kind.
  ["forms_get_submission", "none"],
  // -> formSubmissionsPull.pull: host reads, then per row receipt + submission + outbox in one
  //    transaction, then an acknowledgement to the host for the committed rows.
  ["forms_pull_submissions", "mutates-durable-state"],
  // -> formDeliveryStatus.forSubmission / recentUnfinished: indexed reads of delivery jobs, no write.
  ["forms_delivery_status", "none"],
]);

/**
 * The Forms errors that reach the model with their real reason instead of a redacted
 * `INTERNAL_ERROR` — see `@jini-ai/core/model-facing-tool-errors` for the mechanism and for why
 * this list is an ALLOWLIST rather than a blanket unwrap.
 *
 * Codes keep this domain's per-class vocabulary (`FORMS_SLUG_CONFLICT`,
 * `FORMS_DEFINITION_NOT_FOUND`, ...), the same discipline the widgets tool wiring
 * follows, so the model-facing token matches what that class already claims to be.
 *
 * `FormFieldValidationError` is deliberately ABSENT, and its absence is load-bearing rather than an
 * oversight: `isFormsShapeRejection`/`withSchemaOnRejection` already converts it into a
 * schema-decorated `ToolInputError`, which `reclassifyToolError` passes through untouched. Listing
 * it here would prepend a second code onto a message that has already been shaped for the model.
 * the host's model-facing-errors test pins that non-interference directly.
 *
 * On PII: a form SUBMISSION carries whatever a visitor typed, but no error class here interpolates
 * submission content — `FormSubmissionNotFoundError` names the id the caller itself supplied, and
 * nothing else. `FormSubmissionValidationError` is listed for the public-submit path's benefit even
 * though no tool in this catalog currently reaches it; its `fieldErrors` detail rides on the
 * property, not in the `message` this surfaces.
 */
const formsModelFacingErrors = ({ hostReads }: { hostReads?: HostReadVocabulary | undefined }, _optional = {}): readonly ModelFacingErrorRule[] => [
  versionConflictRule({ readToolId: resolveHostReadText({ text: "{{read:form_definition}}" }, { hostReads }) }),
  forbiddenRule({ domainPrefix: "FORMS", error: ForbiddenError }),
  { error: FormDefinitionNotFoundError, code: "FORMS_DEFINITION_NOT_FOUND" },
  { error: FormSubmissionNotFoundError, code: "FORMS_SUBMISSION_NOT_FOUND" },
  { error: FormSlugConflictError, code: "FORMS_SLUG_CONFLICT" },
  { error: FormSubmissionValidationError, code: "FORMS_SUBMISSION_VALIDATION_ERROR" },
  { error: FormRateLimitExceededError, code: "FORMS_RATE_LIMIT_EXCEEDED" },
];

/**
 * The Forms tool registrations for one set of package deps: the catalog, the nine handlers, the
 * authored risk map and the typed-error mapping. Carries no host search vocabulary or approval
 * policy: `buildFormsRegistrations` binds those.
 */
export function buildFormsToolRegistrations(
  { deps }: { deps: FormsPackageToolDeps },
  { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {},
): ToolRegistration[] {
  const args = { deps, hostReads };
  const handlers: Record<string, ToolHandler> = {
    forms_list_providers: formsListProvidersHandler(args),
    forms_list_definitions: formsListDefinitionsHandler(args),
    forms_create_definition: formsCreateDefinitionHandler(args),
    forms_update_definition: formsUpdateDefinitionHandler(args),
    forms_set_definition_status: formsSetDefinitionStatusHandler(args),
    forms_list_submissions: formsListSubmissionsHandler(args),
    forms_get_submission: formsGetSubmissionHandler(args),
    forms_delivery_status: formsDeliveryStatusHandler(args),
    forms_pull_submissions: formsPullSubmissionsHandler(args),
  };

  // No `unwiredToolIds`: Forms wires its ENTIRE catalog, which makes a new catalog entry added
  // without a handler a build failure rather than a silently missing tool.
  return buildDomainRegistrations({
    domain: "forms",
    catalogModule: "forms/agent-tools.ts",
    catalog: formsCatalogById({ hostReads }),
    // The whole map at once, so no handler can be the one that forgot — see
    // `withModelFacingErrors`' own doc for why a per-call-site reshape is the defect this avoids.
    // Composes with the three handlers' inner `withSchemaOnRejection` rather than competing with
    // it: a shape rejection is already a `ToolInputError` by the time it reaches here, and
    // `reclassifyToolError` returns those untouched.
    handlers: withModelFacingErrors({ handlers, rules: formsModelFacingErrors({ hostReads }) }),
    derivedRisk: formsDerivedRisk,
  });
}

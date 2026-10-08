/** Test-only composition for the Tovu-call-shape copies; every behavior calls its Jini owner. */
import type { Clock, Logger } from "@jini-ai/core/primitives";
import type { FormSubmissionRepoPort } from "./repo-ports.fixture.js";
import type { FormAuthoring } from "../../fields-json.js";
import { createFormAuthoring, prepareFormAuthoring as prepare, withFormAuthoring, htmlSubmissionDefinition } from "../../html/index.js";
import { createFormDefinition as create, updateFormDefinition as update, type FormWriteServiceDeps, type CreateFormDefinitionRequired, type UpdateFormDefinitionRequired, type CreateFormDefinitionOptional, type UpdateFormDefinitionOptional } from "../../write-service.js";
import { submitForm as submit, type SubmitFormDeps, type SubmitFormInput } from "../../submit-service.js";
import { createSubmissionAttempts, type SubmissionAttempts } from "../../submission-attempts.js";
import { deleteFormSubmission as remove } from "../../delete-submission.js";
import { deriveAvailableFormSlug as deriveSlug, slugifyFormName as slugName } from "../../duplicate-slug.js";
import { createRateLimiter as limiter } from "../eventing.fixture.js";

export { executeCommand } from "../../../core/index.js";
export { InMemoryChangeSetRepo } from "../change-set.fixture.js";
export { FORM_SLUG_MAX_LENGTH } from "../../duplicate-slug.js";
export const FORMS_SUBMIT_PROFILE = { windowSeconds: 60, max: 5, burst: 0 };
export function createRateLimiter(_required: { profile: typeof FORMS_SUBMIT_PROFILE; clock: Clock }) { return limiter(); }

const authoring = createFormAuthoring({ permission: "pages.edit_html" });
const policy = { permission: "admin.forms.manage", reservedSlugs: new Set(["new"]) };
const logger: Pick<Logger, "warn"> = { warn() {} };

type LegacyWriteDeps = Omit<FormWriteServiceDeps, "permission" | "reservedSlugs"> & { outbox?: CreateFormDefinitionOptional["outbox"] };
export function createFormDefinition(
  { deps, input }: { deps: LegacyWriteDeps; input: CreateFormDefinitionRequired["input"] & Pick<CreateFormDefinitionOptional, "notify" | "idempotencyKey"> },
) {
  const { notify, idempotencyKey, ...values } = input;
  return create({ deps: { ...deps, ...policy }, input: values }, {
    authoring, ...(notify === undefined ? {} : { notify }), ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(deps.outbox === undefined ? {} : { outbox: deps.outbox }),
  });
}
export function updateFormDefinition(
  { deps, input }: { deps: LegacyWriteDeps; input: UpdateFormDefinitionRequired["input"] & { idempotencyKey?: string } },
) {
  const { idempotencyKey, ...values } = input;
  return update({ deps: { ...deps, ...policy }, input: values }, {
    authoring, ...(idempotencyKey === undefined ? {} : { idempotencyKey }), ...(deps.outbox === undefined ? {} : { outbox: deps.outbox }),
  });
}
export function prepareFormAuthoring(required: Omit<Parameters<typeof prepare>[0], "permission">) { return prepare({ ...required, permission: "pages.edit_html" }); }
export { withFormAuthoring };

const attemptsByStore = new WeakMap<FormSubmissionRepoPort, SubmissionAttempts>();
export function submitForm({ deps, input }: {
  deps: Omit<SubmitFormDeps, "dispatcher" | "logger" | "submissionRepo"> & { submissionRepo: FormSubmissionRepoPort; bus: unknown };
  input: SubmitFormInput;
}) {
  let attempts = attemptsByStore.get(deps.submissionRepo);
  if (!attempts) {
    // Deterministic opaque hash port double; production binds SHA-256 in its composition.
    const keys = new Map<string, string>();
    attempts = createSubmissionAttempts({ hash: (input) => {
      let key = keys.get(input);
      if (key === undefined) { key = `test-attempt-${keys.size}`; keys.set(input, key); }
      return key;
    } });
    attemptsByStore.set(deps.submissionRepo, attempts);
  }
  return submit({ deps: {
    ...deps,
    submissionRepo: deps.submissionRepo,
    transaction: (work) => deps.submissionRepo.transaction(work),
    dispatcher: { dispatch: async () => {} }, logger,
  }, input }, { definitionView: htmlSubmissionDefinition, validateEmails: true, attempts });
}
export function deleteFormSubmission(required: Omit<Parameters<typeof remove>[0], "submissionRepo" | "remove" | "clock">, ports: Pick<Parameters<typeof remove>[0], "submissionRepo" | "remove" | "clock">) {
  return remove({ ...required, ...ports });
}

/** Narrow slugify port double for the copied ASCII/Latin cases. Production injects its real owner. */
const slugify = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export function slugifyFormName(name: string) { return slugName({ name, slugify }); }
export function deriveAvailableFormSlug(required: { name: string }, ports: { isTaken: (slug: string) => Promise<boolean> }) {
  return deriveSlug({ ...required, ...ports, slugify, maxAttempts: 1000, reservedSlugs: policy.reservedSlugs });
}

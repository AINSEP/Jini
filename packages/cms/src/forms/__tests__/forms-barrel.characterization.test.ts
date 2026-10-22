/**
 * @file Characterization pin for the `@jini-ai/cms/forms` barrel (`../index.ts`).
 * Why: delivery additions extend this barrel; every runtime export that existed before them must
 * stay exported under the same name so existing hosts keep compiling and linking unchanged.
 */
import { expect, test } from "vitest";
import * as forms from "../index.js";

// Runtime export surface captured on the unmodified barrel (2026-10-20).
const EXPORTS_BEFORE_DELIVERY = [
  "ATTRIBUTE_NAME_PATTERN", "DUPLICATE_ATTEMPT", "DUPLICATE_SUBMISSION_WINDOW_MS", "FIELD_ID_PATTERN", "FIELD_TYPES",
  "FIELD_TYPE_REGISTRY", "FORM_ATTEMPT_FIELD", "FORM_SLUG_MAX_LENGTH", "FormDefinitionNotFoundError",
  "FormFieldValidationError", "FormRateLimitExceededError", "FormSlugConflictError", "FormSubmissionNotFoundError",
  "FormSubmissionValidationError", "HONEYPOT_KEY", "InMemoryFormDefinitionRepo", "InMemoryFormSubmissionRepo",
  "MAX_ATTRIBUTES_PER_FIELD", "MAX_ATTRIBUTE_VALUE_LENGTH", "MAX_CLASS_NAME_LENGTH", "MAX_FIELDS", "MAX_FORM_FILE_BYTES",
  "MAX_LABEL_LENGTH", "MAX_MAX_LENGTH", "MAX_NAME_LENGTH", "MAX_NOTIFY_RECIPIENTS", "MIN_MAX_LENGTH",
  "SAFE_FORM_FILE_TYPES", "SLUG_PATTERN", "SUBMISSION_IP_RETENTION_DAYS", "assertSubmissionEmails",
  "buildFormsRateLimitKey", "createFormDefinition", "createSubmissionAttempts", "decodeFormFields",
  "deleteFormSubmission", "deriveAvailableFormSlug", "encodeFormFields", "escapeFormHtml", "isBrowserSafeFieldPattern",
  "isHoneypotTripped", "isSafeFieldPattern", "registerFormNotifySubscriber", "renderHtmlForm", "renderHtmlFormBody",
  "resolveFormField", "setFormDefinitionStatus", "slugifyFormName", "submissionAttemptKey", "submitForm",
  "sweepExpiredSubmissionIps", "updateFormDefinition", "validateFieldDescriptors", "validateSubmissionPayload",
];

test("every pre-delivery runtime export is still exported by the forms barrel", () => {
  expect(Object.keys(forms)).toEqual(expect.arrayContaining(EXPORTS_BEFORE_DELIVERY));
});

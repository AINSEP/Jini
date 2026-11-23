import { createHash } from "node:crypto";
import { canonicalJson } from "@jini-ai/core/records";
import { FIELD_TYPE_REGISTRY, submissionEvidenceSchema, type FormDefinitionRecord, type FormDeliveryForm, type HtmlFormDefinitionRecord } from "../index.js";
import { type FormSubmissionEvidence } from "@jini-ai/core/contracts/forms";
import { htmlSubmissionDefinition } from "../html/index.js";
import { fieldMaxChars } from "../index.js";

/**
 * @file The compact form manifest a hosting target receives so it can accept the site's forms where
 * the host's own server does not run (a static export). Generic: no host is named here. Names, required
 * flags, lengths, original labels/consent evidence and receiver validation; notification recipients and answers never leave the host, and
 * full validation still runs in the host when submissions are pulled back.
 */
export interface FormDestinationManifestForm {
  readonly slug: string;
  readonly evidence: Omit<FormSubmissionEvidence, "capturedAt" | "source">;
  readonly fields: readonly { readonly name: string; readonly type?: string; readonly options?: readonly string[]; readonly minLength?: number; readonly min?: number | string; readonly max?: number | string; readonly step?: number; readonly checkboxValue?: string; readonly validationUnsupported?: true; readonly required: boolean; readonly maxLength?: number; readonly multiple?: true }[];
}

/**
 * Active definitions only, in their stored order. HTML-mode forms use the same submission view the
 * live endpoint validates against, so the posted names match.
 * @complexity O(total schema bytes plus canonical key sorting) time/space; no I/O.
 * @overallScore 98 — Minor: schema validity belongs to the authored-definition boundary.
 */
export function buildFormDestinationManifest({ definitions }: { definitions: readonly HtmlFormDefinitionRecord[] }, _optional = {}): FormDestinationManifestForm[] {
  return definitions.filter((definition) => definition.status === "active" && (!definition.provider || definition.provider.id === "builtin")).map((stored) => {
    const definition = htmlSubmissionDefinition({ definition: stored, body: {} });
    const schema = submissionEvidenceSchema({ definition });
    const evidence = { version: 1 as const, ...schema, schemaHash: createHash("sha256").update(canonicalJson({ value: schema })).digest("hex") };
    return { slug: definition.slug, evidence, fields: definition.fields.map((field) => ({ ...manifestField(field), ...submitCap(field), ...receiverValidation(field) })) };
  });
}

/** The live submit path's cap (`field-length-caps.ts`), defaults included, so a static host refuses
 *  the same over-long answers the host's own server would.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function submitCap(field: FormDefinitionRecord["fields"][number]): { maxLength?: number } {
  const maxLength = fieldMaxChars({ field });
  return maxLength === undefined ? {} : { maxLength };
}

/**
 * The form as a push delivery receives it: the manifest's fields plus each field's `label` and
 * `type` and original option labels, so a destination can name its columns and historical choices. Used for the snapshot frozen when a submission is
 * planned, whatever the definition's status is now (the submission was accepted already).
 * @complexity O(total schema bytes) time/space; no I/O. @overallScore 100
 */
export function buildFormDeliveryForm({ definition: stored }: { definition: FormDefinitionRecord }, _optional = {}): FormDeliveryForm {
  const definition = htmlSubmissionDefinition({ definition: stored, body: {} });
  return { slug: definition.slug, fields: definition.fields.map((field) => ({ ...manifestField(field), label: field.label, type: field.type, ...(field.options ? { options: structuredClone(field.options) } : {}) })) };
}

/** Project the existing receiver identity and cardinality wire fields.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function manifestField(field: FormDefinitionRecord["fields"][number]): Pick<FormDestinationManifestForm["fields"][number], "name" | "required" | "maxLength" | "multiple"> {
  return {
    name: field.name ?? field.id,
    required: field.required,
    ...(typeof field.maxLength === "number" ? { maxLength: field.maxLength } : {}),
    ...((FIELD_TYPE_REGISTRY as Record<string, { multiple?: boolean }>)[field.type]?.multiple === true ? { multiple: true as const } : {}),
  };
}

/** Describe the receiver's supported subset; unsupported rules fail at destination preparation,
 * before a visitor can be told that an invalid answer succeeded.
 * @complexity O(options) time/space; no I/O. @overallScore 100 */
function receiverValidation(field: FormDefinitionRecord["fields"][number]): Partial<FormDestinationManifestForm["fields"][number]> {
  return { type: field.type,
    ...(field.options ? { options: field.options.map(option => option.value).filter(value => value !== '') } : {}),
    ...receiverTextRules(field), ...receiverBounds(field), ...receiverStep(field),
  };
}

/** Preserve native descriptor precedence over authored attribute fallbacks.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function receiverTextRules(field: FormDefinitionRecord["fields"][number]): Partial<FormDestinationManifestForm["fields"][number]> {
  const pattern = field.pattern ?? field.attributes?.pattern;
  const minLength = field.minLength ?? field.attributes?.minlength;
  return {
    ...(minLength === undefined ? {} : { minLength: Number(minLength) }),
    ...(field.checkboxValue === undefined ? {} : { checkboxValue: field.checkboxValue }),
    ...(pattern === undefined ? {} : { validationUnsupported: true as const }),
  };
}

/** Preserve numeric and temporal bounds without normalizing their authored spelling.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function receiverBounds(field: FormDefinitionRecord["fields"][number]): Partial<FormDestinationManifestForm["fields"][number]> {
  const min = field.min ?? field.attributes?.min;
  const max = field.max ?? field.attributes?.max;
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

/** Convert the supported native numeric step to its manifest representation.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function receiverStep(field: FormDefinitionRecord["fields"][number]): { step?: number } {
  const step = field.step ?? field.attributes?.step;
  return step === undefined ? {} : { step: Number(step) };
}

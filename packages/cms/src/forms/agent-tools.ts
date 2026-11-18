/**
 * @file The Forms agent-tool catalog (SPEC-010, ADR-PIPE-010), instantiating SPEC-016 REQ-22's
 * naming/callability convention for this domain — the same shape
 * `Jini packages/cms/src/content-types/agent-tools.ts` uses, including its `inputSchema` contract.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real exported function of
 * `forms/write-service.ts` — this catalog never names an operation the domain cannot perform.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - There is NO `forms_delete_definition`, and no description here may imply one. A form
 *   definition is removed permanently only by a Trash purge under the owner's policy, never
 *   through this catalog's tools, and
 *   `FormDefinitionRepoPort` enforces that structurally by exposing no `delete` method at all.
 *   "Delete this form" must therefore route an agent to `forms_set_definition_status` (to disable
 *   it) or to the Trash's own tools — never to a lever that does not exist here. This mirrors
 *   the recovery tools' identical discipline around `backup_confirm_restore`.
 * - Submissions carry a separate permission tier (`admin.forms.submissions.*`) that does not go
 *   through `write-service.ts` — the host's admin submission routes gate
 *   directly, the same split `comments/agent-tools.ts` makes for its read tools. Read access
 *   (`forms_list_submissions`/`forms_get_submission`) IS wired below: a `FormSubmissionRecord` is
 *   `{id, formDefinitionId, data, sourceIp, submittedAt}` (`types.ts`) — the same visitor-typed
 *   field values plus one raw request IP the human admin submissions screen already displays, no
 *   payment or credential material of any kind, so listing/reading what a human operator can
 *   already see through the same permission is not a new exposure. There is deliberately NO
 *   `forms_delete_submission`: unlike a form definition (which only ever gets soft-retired) a
 *   submission's delete is genuinely irreversible and, unlike `identity_role_delete`/
 *   `identity_policy_delete`, carries no "still referenced, so refuse" guard at all — nothing stops
 *   a single call from permanently destroying a visitor's data with no way back. That asymmetry
 *   (reversible read vs. unconditional permanent write) is exactly the read/write split this pass's
 *   directive asks for; delete stays human-UI-only. (Since trash T4, `trash_item` can move a
 *   submission to the Trash, restorable for 60 days; that is not a permanent delete, and
 *   `forms_list_submissions`' description points the model there.)
 *
 * How it relates to the project:
 * the host's tool assembly maps these entries into `@jini-ai/core` `ToolRegistration`s;
 * the ADR-014 tool filter consumes the catalog to decide which names a session may see. Actual
 * enforcement is `executeCommand`'s ADR-021 `authorize()` inside each write-service function —
 * this module declares shape only and performs no I/O.
 *
 * Architectural role:
 * `forms` domain declaration. Imports only the constants its own domain already enforces, so the
 * published JSON Schemas cannot drift from the validators. Deliberately does NOT import
 * `./manifest` (ADR-PIPE-010 Enforcement: the manifest is read BY activation code, never BY domain
 * code) — the field-type list is taken from `@jini-ai/cms/forms`, which now owns the validators
 * and their rationale.
 */

import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import { ATTRIBUTE_NAME_PATTERN, FIELD_ID_PATTERN, FIELD_TYPES, MAX_ATTRIBUTES_PER_FIELD, MAX_ATTRIBUTE_VALUE_LENGTH, MAX_CLASS_NAME_LENGTH, MAX_FIELDS, MAX_LABEL_LENGTH, MAX_MAX_LENGTH, MIN_MAX_LENGTH } from "./forms.js";
import { DELIVERY_STATUS_MAX_LIMIT } from "./delivery-status-limits.js";
import { MAX_NAME_LENGTH, MAX_NOTIFY_RECIPIENTS, SLUG_PATTERN } from "./write-service.js";

const FORMS_MANAGE_PERMISSION = "admin.forms.manage" as const;

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (the host's tool assembly, which refuses to wire any tool lacking one). Structurally
 * identical to the content-types catalog's field of the same name.
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/** One entry of a `fields` array, as published to the model. Mirrors what `forms.ts`'s `validateFieldDescriptors` enforces. */
const FIELD_DESCRIPTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "type", "required"],
  properties: {
    id: {
      type: "string",
      pattern: FIELD_ID_PATTERN.source,
      description: "Stable field id. Lowercase letters, digits and underscores; must start with a letter. Ids are permanent — an existing id can never be removed by an update.",
    },
    label: { type: "string", minLength: 1, maxLength: MAX_LABEL_LENGTH, description: "Human-readable label shown above the input." },
    type: {
      type: "string",
      enum: [...FIELD_TYPES],
      description: "A registered native field type. Use select for a dropdown; multi-select, radio and checkbox-group require options. Phone renders type=tel, datetime renders datetime-local, toggle renders an accessible switch.",
    },
    required: { type: "boolean", description: "Whether the visitor must fill this field in. Must be a real boolean, not a string. Required checkbox/toggle consent must be checked." },
    name: { type: "string", pattern: FIELD_ID_PATTERN.source, description: "Optional native input name; must equal id to preserve stored submission keys." },
    placeholder: { type: "string", maxLength: 500 },
    helpText: { type: "string", maxLength: 500, description: "Accessible help shown with the field." },
    default: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", maxItems: 100, items: { type: "string" } }], description: "Initial control value, checked state, or selected option values. Must satisfy this field's rules; forbidden for files." },
    options: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["value", "label"], properties: { value: { type: "string", minLength: 1, maxLength: 200 }, label: { type: "string", minLength: 1, maxLength: 200 } } }, description: "Required for select, multi-select, radio, checkbox-group. Values must be unique; submissions reject values outside this list." },
    minLength: { type: "integer", minimum: 0, maximum: MAX_MAX_LENGTH },
    pattern: { type: "string", maxLength: 300, description: "Full-match text validation. Safe subset: literals, character classes, anchors and one repetition; groups, alternation and backreferences are rejected." },
    min: { type: ["number", "string"], description: "Numeric lower bound, or ISO native date/time lower bound." },
    max: { type: ["number", "string"], description: "Numeric upper bound, or ISO native date/time upper bound." },
    step: { type: "number", exclusiveMinimum: 0, description: "Numeric increment for number/range. Defaults to 1." },
    accept: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" }, description: "Safe MIME types or image/*, video/*, */*. Omitted means any recognized safe file: PNG/JPEG/GIF/WebP/AVIF, MP4/WebM, PDF. Executables, scripts, markup and archives are always refused." },
    maxFileSize: { type: "integer", minimum: 1, maximum: 10485760, description: "File size limit in bytes, capped at 10 MiB. All uploads in one multipart POST must fit 12 MiB." },
    checkboxValue: { type: "string", description: "Optional authored checkbox wire value; every other submitted string is rejected." },
    maxLength: {
      type: ["integer", "null"],
      minimum: MIN_MAX_LENGTH,
      maximum: MAX_MAX_LENGTH,
      description: `Optional per-field character cap (${MIN_MAX_LENGTH}-${MAX_MAX_LENGTH}). Only supported on text, textarea, email, phone, url and hidden fields.`,
    },
    className: {
      type: "string",
      maxLength: MAX_CLASS_NAME_LENGTH,
      description:
        "Optional CSS class names applied verbatim to the rendered input element (e.g. Tailwind utility classes like 'md:col-span-2 w-1/2'). Any string is accepted — classes are escaped, not sanitized or restricted to a vocabulary.",
    },
    attributes: {
      type: "object",
      maxProperties: MAX_ATTRIBUTES_PER_FIELD,
      propertyNames: { pattern: ATTRIBUTE_NAME_PATTERN.source },
      additionalProperties: { type: "string", maxLength: MAX_ATTRIBUTE_VALUE_LENGTH },
      description:
        "Optional extra HTML attributes applied to the rendered input element. Attribute NAMES are strictly allowlisted — 'aria-*', 'data-*', 'placeholder', 'autocomplete', 'inputmode', 'pattern', 'title', 'min', 'max', 'step', 'minlength', 'spellcheck', 'readonly'. Anything else, including any 'on*' event handler, 'style', 'formaction', 'href', 'src', 'srcdoc', 'id', 'name', or 'type', is rejected — the call fails rather than silently dropping it. Values are plain strings.",
    },
  },
} as const;

/** The `fields` property shared by create and update. */
const FIELDS_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: MAX_FIELDS,
  items: FIELD_DESCRIPTOR_SCHEMA,
  description: `The COMPLETE field list (1-${MAX_FIELDS} fields). Both tools that accept it replace the whole list, so it must include every field the form keeps — but note that unlike a content type, an EXISTING field id may never be dropped; omitting one is rejected rather than deleting it.`,
} as const;

/** The `notify` property shared by create and update. */
const NOTIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "recipients"],
  properties: {
    enabled: { type: "boolean", description: "Whether to email recipients on each submission." },
    recipients: {
      type: "array",
      maxItems: MAX_NOTIFY_RECIPIENTS,
      items: { type: "string", description: "A valid email address." },
      description: `Up to ${MAX_NOTIFY_RECIPIENTS} email addresses. Each must be a valid address or the whole call is rejected.`,
    },
  },
} as const;

const FORM_ID_SCHEMA = {
  type: "string",
  description: "The form definition's id, as returned by a create call. This is the opaque id, NOT the slug.",
} as const;

/**
 * Submission pagination bounds — mirrors the host's admin submissions route's own
 * `MIN_LIMIT`/`MAX_LIMIT` literals (not exported from there, since a domain catalog does not import
 * a route file; kept in sync by hand, the same disclosed duplication `types.ts`'s own header
 * already accepts for `FieldType` vs. `manifest.ts`).
 */
const SUBMISSIONS_MIN_LIMIT = 1;
const SUBMISSIONS_MAX_LIMIT = 100;

const SUBMISSION_ID_SCHEMA = {
  type: "string",
  description: "The submission's id, as returned by forms_list_submissions.",
} as const;

/** The form-definition read's input — it takes no arguments at all, matching how the host's identity-user, identity-role and menu
 * reads are this codebase's convention for a small, bounded catalog: one unfiltered list IS the domain's "search", not a separate capability. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

/**
 * Forms' fixed agent-tool catalog: the three `write-service.ts` operations plus the two read-only
 * submission tools.
 *
 * The three definition tools are gated on `admin.forms.manage`, which is what each `executeCommand`
 * call in `write-service.ts` actually passes to `authorize()`. Forms declares no separate read
 * capability for definitions (the human
 * `list.ts`/`get-by-id.ts` routes already authorize reads against `admin.forms.manage`), so nothing
 * here invents an `admin.forms.read` that no policy would ever grant.
 *
 * The two submission tools are gated on the SEPARATE `admin.forms.submissions.read` permission —
 * exactly what the host's admin submission routes check, since submissions are visitor
 * data with their own permission tier, not form-configuration state.
 */
const FORM_PROVIDER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["id", "config"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$", description: "Collection provider id from forms_list_providers. Existing definitions and history stay local when switching." },
    config: { type: "object", additionalProperties: { type: "string" }, description: "Public string-valued settings described by forms_list_providers; never credentials or secrets." },
  },
} as const;

export const formsAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "forms_list_providers",
    description: "Lists the currently registered form collection providers, their public settings fields, answer location and validation behavior. Call before selecting a provider in forms_create_definition or forms_update_definition. Read-only; unavailable settings include an explanation and must not be guessed.",
    sideEffects: "none",
    authorization: { permission: FORMS_MANAGE_PERMISSION },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "forms_list_definitions",
    description:
      "Lists every form definition in the workspace with its id, name, slug, status, and field count. Read-only. Call this to find a form's opaque id from its name or slug before calling forms_update_definition, forms_set_definition_status, forms_list_submissions, or forms_get_submission — those tools take formId, not slug.",
    sideEffects: "none",
    authorization: { permission: FORMS_MANAGE_PERMISSION },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "forms_create_definition",
    description:
      "Creates a new form definition from a name, a URL slug, and a complete list of native field descriptors. Call forms_list_providers before selecting a public collection provider. For a dropdown, use type=select with options [{value,label}]. The slug must be unique within the workspace and can never be changed afterwards. To show this form in a post or other rich-text body, use widgets_create_instance to create a contact-form widget with config { formDefinitionId: <this form's id> }, then widgets_insert_embed it; HTML-format pages and theme templates can instead use a data-embed-config marker with {type:\"form\",id:<this form's id or slug>}.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: FORMS_MANAGE_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "slug", "fields"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH, description: "Human-readable form name shown in the admin UI." },
        slug: {
          type: "string",
          pattern: SLUG_PATTERN.source,
          description: "Permanent URL slug. Lowercase letters, digits and hyphens; must start with a letter or digit; max 64 characters. Cannot be changed later, and must not already exist in this workspace.",
        },
        fields: FIELDS_SCHEMA,
        notify: NOTIFY_SCHEMA,
        provider: FORM_PROVIDER_SCHEMA,
      },
    },
  },
  {
    name: "forms_update_definition",
    description:
      "Updates an existing form definition's name, field list, notification recipients, or public collection provider. Call forms_list_providers before selecting a provider and explain its answer location and validation; republish all affected static pages and Cloudflare manifests after switching. The slug is immutable and is ignored if supplied. Existing field ids cannot be dropped — omitting one is rejected, not treated as a deletion. Pass expectedVersion from {{read:form_definition}}; if someone changed it since, nothing is saved and you must re-read.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: FORMS_MANAGE_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["formId", "expectedVersion"],
      properties: {
        formId: FORM_ID_SCHEMA,
        expectedVersion: { type: "integer", minimum: 0, description: "The record's version from {{read:form_definition}}. Required." },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH, description: "New form name. Omit to leave unchanged." },
        fields: FIELDS_SCHEMA,
        notify: NOTIFY_SCHEMA,
        provider: FORM_PROVIDER_SCHEMA,
      },
    },
  },
  {
    name: "forms_set_definition_status",
    description:
      "Sets a form definition's status to 'active' or 'disabled'. Disabling is how a form is taken out of service without deleting it — no tool in this catalog can delete a form definition; permanent deletion happens only through the Trash.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: FORMS_MANAGE_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["formId", "status"],
      properties: {
        formId: FORM_ID_SCHEMA,
        status: {
          type: "string",
          enum: ["active", "disabled"],
          description: "'disabled' takes the form out of service (its stored submissions are retained); 'active' puts it back.",
        },
      },
    },
  },
  {
    name: "forms_list_submissions",
    description:
      "Lists a form's submissions, newest-first, with each submission's field values, source IP, and submission time. Read-only. To remove a submission, move it to the Trash with trash_item (entityType 'form_submission'); permanent removal stays human-only, from the Trash screen.",
    sideEffects: "none",
    authorization: { permission: "admin.forms.submissions.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["formId"],
      properties: {
        formId: FORM_ID_SCHEMA,
        limit: {
          type: "integer",
          minimum: SUBMISSIONS_MIN_LIMIT,
          maximum: SUBMISSIONS_MAX_LIMIT,
          description: `Page size, ${SUBMISSIONS_MIN_LIMIT}-${SUBMISSIONS_MAX_LIMIT}. Defaults to 50 if omitted.`,
        },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous call's nextCursor. Omit for the first page." },
      },
    },
  },
  {
    name: "forms_get_submission",
    description: "Reads one submission's full field values, source IP, and submission time by id. Read-only.",
    sideEffects: "none",
    authorization: { permission: "admin.forms.submissions.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["formId", "submissionId"],
      properties: { formId: FORM_ID_SCHEMA, submissionId: SUBMISSION_ID_SCHEMA },
    },
  },
  {
    name: "forms_pull_submissions",
    description:
      "Brings form submissions that a static export stored at its hosting provider back into Submissions here, checks them with the form's own rules, and sends the usual new-submission notifications. Only rows saved here are cleared at the host, so pulling again is always safe and never duplicates. Use it when the owner asks for new entries from a static export. Returns a plain summary per hosting target, counts per form (formId, formSlug, imported, alreadyImported, unmapped, failed) with totals, and ran: false with reason 'already-running' when another pull of the same host is still in progress.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: FORMS_MANAGE_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetId: { type: "string", minLength: 1, maxLength: 64, description: "Optional hosting target id to pull from that target only. Omit to pull from every hosting target that receives forms." },
      },
    },
  },
  {
    name: "forms_delivery_status",
    description:
      "Shows whether form submissions reached the destinations configured to receive them (the site's form delivery bindings): per binding, its status (pending, retrying, completed or failed), attempts so far, the next retry time and a short error code. With submissionId, that submission's deliveries; without it, the most recent deliveries that have not completed. Read-only; never shows answers, destination addresses or credentials.",
    sideEffects: "none",
    authorization: { permission: "admin.forms.submissions.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        submissionId: SUBMISSION_ID_SCHEMA,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: DELIVERY_STATUS_MAX_LIMIT,
          description: `Without submissionId: how many unfinished deliveries to list, 1-${DELIVERY_STATUS_MAX_LIMIT}. Defaults to ${DELIVERY_STATUS_MAX_LIMIT}.`,
        },
      },
    },
  },
];

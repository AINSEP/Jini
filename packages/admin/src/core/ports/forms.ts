/**
 * @file `AdminFormsPort` — form definitions (the schema an operator builds) and their submissions
 * (the data visitors send in).
 *
 * ## Form DEFINITIONS have no delete, structurally — only `status`
 *
 * Mirrors `AdminIdentityPort.disableUser`'s reasoning exactly (see that file's header): the
 * reference implementation's `FormDefinitionRepoPort` has no delete method AT ALL — not gated behind a permission, not a
 * two-rung ladder, structurally absent — because a definition is meant to stay resolvable for
 * historical submissions. The only lifecycle move is `active` ⇄ `disabled` via
 * `updateFormDefinition`'s `status` field. There is deliberately no `deleteFormDefinition` on this
 * port; a reference implementation has nothing to call.
 *
 * ## `updateFormDefinition`'s `fields` patch can add or edit, never remove
 *
 * When `patch.fields` is supplied it replaces the whole array, but the reference implementation's write chokepoint rejects
 * (validation-class) any replacement that omits a field `id` present in the current definition —
 * existing fields can be reordered or edited in place, and new ones appended, but never dropped
 * through this call. There is no separate "remove a field" operation on the reference
 * implementation.
 *
 * ## No `slug` in the update patch — and the rule this follows
 *
 * A definition's `slug` is immutable after creation. The reference implementation's write-service silently ignores a
 * `slug` sent in an update patch rather than rejecting it (a documented, deliberate choice on their
 * side) — sent, accepted, and dropped with no error and no effect.
 *
 * This port set applies one rule to that entire family of cases, wherever a reference
 * implementation treats a well-formed, in-contract input specially:
 *
 * - **A silently-ignored input is removed from the contract.** If sending it produces no error and
 *   no effect, keeping it as a field would make the type lie about having an effect it doesn't
 *   have — which is the exact failure mode these ports exist to prevent. `AdminFormUpdatePatch` has
 *   no `slug` for this reason; there is nothing to silently drop because there is nothing to send.
 * - **A loudly-rejected input stays in the contract and gets documented.** If sending it produces a
 *   real, typed rejection, the caller learns the truth at runtime — and because the surrounding
 *   union is OPEN, a different host may legitimately accept what the reference implementation
 *   refuses. That is a host-capability limit, not a contract lie, so removing the value would
 *   throw away real information. See `redirects.ts`'s file header for the concrete case
 *   (`matchType: "regex"`, kept and documented, never silently dropped).
 *
 * Applied elsewhere in this file: `updateFormDefinition`'s field-removal constraint (below) is a
 * loud rejection (`FormFieldValidationError`), so `fields` stays on `AdminFormUpdatePatch` with the
 * constraint documented, rather than being narrowed to a shape that can't express a removal
 * attempt at all.
 *
 * ## Submission deletion moves to Trash
 *
 * `deleteFormSubmission` models the admin HTTP operation: reversible removal from active reads.
 * The underlying repository's hard-delete primitive is not this admin contract. Restoration and
 * permanent deletion belong to the generic Trash owner (Coordinator authorization, 2026-10-08).
 *
 * ## Open vs. closed unions
 *
 * `FormFieldType` and `FormDefinitionStatus` are reference-implementation-specific vocabularies — OPEN, via the
 * `T | (string & {})` idiom `seo.ts`'s file header introduces for this port set. `FormFieldType` in
 * particular is a small, deliberately-not-yet-exhaustive set on the reference implementation (four
 * field kinds today); a host offering a richer form builder needs room to add its own without this
 * contract standing in the way.
 */

/** A form field's input kind — open, see file header. */
export type FormFieldType = "text" | "email" | "textarea" | "checkbox" | (string & {});

/** Lifecycle of a form definition — open, see file header. There is no "deleted" state; see the
 *  file header on why this port has no delete for definitions at all. */
export type FormDefinitionStatus = "active" | "disabled" | (string & {});

export interface AdminFormField {
  readonly id: string;
  readonly label: string;
  readonly type: FormFieldType;
  readonly required: boolean;
  readonly maxLength?: number | null;
  readonly className?: string | undefined;
  readonly attributes?: Readonly<Record<string, string>> | undefined;
}

export interface AdminFormNotifyConfig {
  readonly enabled: boolean;
  readonly recipients: readonly string[];
}

export interface AdminFormDefinition {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly fields: readonly AdminFormField[];
  readonly notify: AdminFormNotifyConfig;
  readonly status: FormDefinitionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** HTML authoring is explicit; absent mode means the existing Builder contract. */
  readonly mode?: "builder" | "html" | undefined;
  readonly html?: string | undefined;
}

export interface AdminFormSubmission {
  readonly id: string;
  readonly formDefinitionId: string;
  /** Keyed by the definition's field ids at submission time. */
  readonly data: Readonly<Record<string, string | boolean>>;
  readonly sourceIp: string;
  readonly submittedAt: string;
  /** Missing means active for older wire records. Trash preserves the original submission data. */
  readonly status?: "active" | "trash";
}

/** A keyset-paginated page of submissions, newest-first. */
export interface AdminFormSubmissionPage {
  readonly items: readonly AdminFormSubmission[];
  readonly nextCursor: string | null;
}

export interface AdminFormCreateInput {
  readonly name: string;
  readonly slug: string;
  readonly fields: readonly AdminFormField[];
  readonly mode?: "builder" | "html" | undefined;
  readonly html?: string | undefined;
  readonly notify?: AdminFormNotifyConfig;
}

/** No `slug` — see file header. */
export interface AdminFormUpdatePatch {
  readonly name?: string;
  /** A mode/body patch uses the authoring route; an ordinary patch keeps the CRUD route. */
  readonly mode?: "builder" | "html" | undefined;
  readonly html?: string | undefined;
  /** Whole-array replace with an add/edit-only constraint — see file header. */
  readonly fields?: readonly AdminFormField[];
  readonly notify?: AdminFormNotifyConfig;
  readonly status?: FormDefinitionStatus;
}

export interface AdminFormsPort {
  listFormDefinitions(requiredArgs: Record<string, never>): Promise<readonly AdminFormDefinition[]>;
  getFormDefinition(requiredArgs: { id: string }): Promise<AdminFormDefinition>;
  createFormDefinition(requiredArgs: Omit<AdminFormCreateInput, "notify">, optionalArgs?: Pick<AdminFormCreateInput, "notify">): Promise<AdminFormDefinition>;
  /** See file header: `patch.fields`, when supplied, may add or edit but never omit an existing
   *  field id. */
  updateFormDefinition(requiredArgs: { id: string }, optionalArgs?: AdminFormUpdatePatch): Promise<AdminFormDefinition>;
  listFormSubmissions(
    requiredArgs: { formId: string },
    optionalArgs?: { limit?: number; cursor?: string },
  ): Promise<AdminFormSubmissionPage>;
  getFormSubmission(requiredArgs: { formId: string; submissionId: string }): Promise<AdminFormSubmission>;
  /** Move to Trash, preserving data while hiding it from active list/detail reads. The form must
   * own this submission; restoration and permanent deletion remain with the generic Trash owner. */
  deleteFormSubmission(requiredArgs: { formId: string; submissionId: string }, optionalArgs?: Record<string, never>): Promise<void>;
}

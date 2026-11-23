/**
 * @file Form-delivery and form-destination seam types shared with hosts and agent plugins: the
 * delivery binding, its job status and safe error codes, the destination form/credential shapes, the
 * connection port and the publish-side receiver port. Moved from `@jini-ai/cms/forms`
 * (`delivery/types.ts`, `delivery/status.ts`, `destination-contracts.ts`), which re-exports them.
 * Types only (XP4).
 *
 * Also carries the form-definition persistence shapes (`FormDefinitionRecord`,
 * `FormDefinitionRepoPort` and their closure), an additive copy of cms's `forms/types.ts` and
 * `forms/ports.ts`; cms keeps its identical declarations until the paired cutover. The owning
 * package derives `FieldType` from its runtime field registry (`keyof typeof FIELD_TYPE_REGISTRY`);
 * this file spells the same keys out, and the two must list the same members.
 */

import type { FormFieldDescriptor } from "../forms.js";
import type { UUID } from "../../primitives/index.js";

/** One configured destination. Credentials are never stored here, only a reference the host
 * resolves fresh on each attempt, so a rotated or revoked credential takes effect at once. */
export interface FormDeliveryBinding {
  readonly bindingId: string;
  readonly adapterId: string;
  readonly connectionRef: string;
  readonly enabled: boolean;
  /** Absent = every form; [] = no form. */
  readonly formIds?: readonly string[];
  /** Adapter-owned non-secret configuration. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** The only error codes that may reach the outbox ledger or a status read. */
export type FormDeliveryErrorCode =
  | "authorization-required"
  | "rate-limited"
  | "configuration-invalid"
  | "mapping-invalid"
  | "resource-not-granted"
  | "destination-limit"
  | "outcome-unknown"
  | "adapter-unavailable"
  | "delivery-failed";

export type FormDeliveryState = "pending" | "retrying" | "completed" | "failed";
export interface FormDeliveryJobStatus {
  readonly status: FormDeliveryState;
  readonly attempts: number;
  /** Set only while a failed attempt waits for its next try. */
  readonly nextRetryAt: string | null;
  readonly errorCode: FormDeliveryErrorCode | null;
}

/** One active form as a destination receives it: names, required flags and lengths only. Never
 *  markup, theme, notification recipients or answers. A publish adds the site's receiver `secret`.
 *  Push delivery (`deliver`) also gets each field's `label` and `type`; `name` stays the stable id
 *  that keys the answers. */
export interface FormDestinationForm {
  readonly slug: string;
  readonly fields: readonly { readonly name: string; readonly required: boolean; readonly maxLength?: number; readonly multiple?: true; readonly label?: string; readonly type?: string }[];
  /** Site-relative page to show after a successful submission; absent = back to the form's page. */
  readonly successPath?: string;
}
/** What a publish hands a host whose deployment carries a co-hosted receiver. */
export interface FormDestinationPublishInput {
  readonly forms: readonly FormDestinationForm[];
  readonly secret?: string;
}
/** A publish preview's form line: whether submissions will be received, and what that changes.
 *  `off` is core's own answer when no destination is selected or the selection cannot receive. */
export interface FormSubmissionsInspection {
  readonly status: "on" | "off" | "unsupported" | "permission-required";
  readonly forms: number;
  readonly message: string;
  readonly changes: readonly Readonly<Record<string, unknown>>[];
}

/** The host kit a module receives. Structurally the deploy host kit the composition passes (egress
 *  traced through `createDeployHostKit`); only the members a receiver client needs are named. */
export interface FormDestinationKit {
  fetch(url: string, init: RequestInit, options: { readonly timeoutMs: number }): Promise<Response>;
  readonly timeouts: unknown;
  now?(): number;
}
/** A destination's own vendor credential, opened from the vault by its exact label. On the push
 *  path, `baseUrl`'s origin plus `additionalHosts` (exact origins) are the only origins the
 *  attempt's `kit.fetch` may reach (the host app's `src/features/form-destinations/deliver.ts`). A connection kind whose tokens are short-lived
 *  (OAuth) also offers `getAccessToken`: one fresh read per provider request, the first returning
 *  `token`, so the connection's request budgets count every request of the attempt. */
export interface FormDestinationCredential { readonly token: string; readonly baseUrl: string; readonly username?: string; readonly additionalHosts?: readonly string[]; readonly getAccessToken?: () => Promise<string> }

/** Resolves a binding's `connectionRef` to the credential its adapter needs, or null when there is
 *  none (deleted, revoked, other workspace). The single seam for connection kinds: the shipped one
 *  opens a custom credential by stable id (the host app's `src/features/form-destinations/connection-port.ts`); an OAuth connection is another
 *  implementation of this same type. Modules never see the vault, only the resolved credential.
 *  `optional.binding` is the job's frozen binding, for a kind that freezes more than the ref (the
 *  OAuth one reads the account the binding was set up with). A port may throw a `FormDeliveryError`
 *  to record a specific code. */
export type FormDeliveryConnectionPort = (
  required: { readonly workspaceId: string; readonly connectionRef: string; readonly adapterId: string },
  optional?: { readonly binding?: FormDeliveryBinding },
) => Promise<FormDestinationCredential | null>;

/** What a publish does with the site's forms: the co-hosted add-on for the host, or the external
 *  receiver's post address, plus the receiver key's save once the publish has reached the host. */
export interface FormReceiverPlan {
  readonly hosting?: FormDestinationPublishInput;
  readonly submitUrl?: string;
  /** Present for a new key, or to move an existing key's address: saves it for later pulls. */
  readonly save?: (required: { readonly url: string }, optional?: Record<string, never>) => Promise<void>;
}
/** The publish-side port static publishing calls. Selection, keys and `prepare` all live behind it. */
export interface FormReceiverPort {
  /** Read-only: what a preview hands the host (`hosting`, co-hosted only) and the form line core
   *  answers itself (external, off or refused). Never reads or creates the receiver key. */
  previewInput(required: { readonly workspaceId: string; readonly hostingTargetId: string; readonly projectName: string; readonly kit: FormDestinationKit }, optional?: Record<string, never>): Promise<{
    readonly hosting?: { readonly forms: readonly FormDestinationForm[] };
    readonly formSubmissions?: FormSubmissionsInspection;
  }>;
  /** Throws a person-facing Error when the selected receiver cannot take this publish. */
  prepare(required: { readonly workspaceId: string; readonly hostingTargetId: string; readonly projectName: string; readonly kit: FormDestinationKit }, optional?: Record<string, never>): Promise<FormReceiverPlan>;
}

// ---- Form definitions (`types.ts`, `ports.ts`) ----

/** Mirrors `keyof typeof FIELD_TYPE_REGISTRY` in the owning package's `forms/field-registry.ts`. */
export type FieldType =
  | "text" | "textarea" | "email" | "phone" | "url" | "number" | "range" | "date" | "time" | "datetime"
  | "select" | "multi-select" | "radio" | "checkbox" | "checkbox-group" | "toggle" | "file" | "hidden";

export type FormDefinitionStatus = "active" | "disabled";

/** The authored field shape, narrowed to the field types this domain registers. */
export type FieldDescriptor = FormFieldDescriptor<FieldType>;

export interface NotifyConfig {
  enabled: boolean;
  recipients: string[];
}

export interface FormDefinitionRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  slug: string;
  fields: FieldDescriptor[];
  notify: NotifyConfig;
  status: FormDefinitionStatus;
  createdAt: string;
  updatedAt: string;

  /** Compare-and-set counter for edits and trash transitions; never an admin-editable field.
   * Every record constructor, including fixtures, must supply it. */
  version: number;
}

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

  /** Update only a live row. Without a basis, a trashed row remains untouched; with one, a
   * mismatched or missing row throws RecordVersionConflictError. Only Trash restore may revive it.
   * Keep create/update separate so genuine insert uniqueness races remain visible. */
  update(record: FormDefinitionRecord, optional?: { expectedVersion?: number }): Promise<void>;

  /** Deliberately trash-blind: both live and trashed rows reserve a slug. Duplication must not
   * propose a trashed slug as available and then collide with the database unique index. */
  isSlugTaken(required: { workspaceId: UUID; slug: string }): Promise<boolean>;
}

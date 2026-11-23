/**
 * @file Form-delivery and form-destination seam types shared with hosts and agent plugins: the
 * delivery binding, its job status and safe error codes, the destination form/credential shapes, the
 * connection port and the publish-side receiver port. Moved from `@jini-ai/cms/forms`
 * (`delivery/types.ts`, `delivery/status.ts`, `destination-contracts.ts`), which re-exports them.
 * Types only (XP4).
 */

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

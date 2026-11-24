import type { FormDeliveryResult } from "./delivery/types.js";
import type { FormDeliveryBinding, FormDestinationCredential, FormDestinationForm, FormDestinationKit, FormSubmissionsInspection } from "@jini-ai/core/contracts/site/cms-forms";
export type { FormDeliveryConnectionPort, FormDestinationCredential, FormDestinationForm, FormDestinationKit, FormDestinationPublishInput, FormReceiverPlan, FormReceiverPort, FormSubmissionsInspection } from "@jini-ai/core/contracts/site/cms-forms";

/**
 * @file The form destination contract: where a published static site's form submissions go, as an
 * Agent Plugin contribution category (a host-named form-destinations file, `./destination-descriptors.ts`). It copies the
 * mail-adapter contribution: a data-only descriptor plus a contained `.mjs` module. Nothing here
 * names a vendor, and this feature imports neither deployments nor forms, so the graph stays
 * acyclic: deployments and the composition root import this file, never the reverse.
 *
 * Two receive modes. `co-hosted`: the receiver lives inside the hosting target's own deployment,
 * so hosting installs it (the publish hands the host {@link FormDestinationPublishInput}) and the
 * destination only pulls and acknowledges. `external`: the destination makes its own receiver exist
 * (`prepare`) and the exported pages post to the address it returns.
 */

/** Where a pull goes: the receiver's origin and the site's receiver key. */
export interface FormDestinationAddress {
  readonly url: string;
  readonly secret: string;
}
/** A submission stored at the receiver, before the host validates and imports it. */
export interface RemoteFormSubmission {
  readonly seq: number;
  readonly id: string;
  readonly formSlug: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly submittedAt: string;
  readonly ip: string | null;
}
export interface FormDestinationPage {
  readonly items: readonly RemoteFormSubmission[];
  readonly nextAfter: number;
  readonly hasMore: boolean;
}
/** Read-only view of the adapter's own plugin settings (scoped to its plugin and workspace), the
 *  same store the plugin's admin surface writes and its tools read. */
export interface FormDestinationPluginState { get(required: { readonly key: string }): Promise<unknown> }

/** A destination module's default export. Every method is optional; the host app's `src/features/form-destinations/registry.ts` checks the set
 *  the descriptor's receive mode needs. All args are `(required, optional)`; effects go through `kit`. */
export interface FormDestinationModule {
  /** Read-only. What `prepare` would create or change. External receivers only; for a co-hosted
   *  receiver, the host's own preview reports this (it holds the hosting credential). */
  preview?(required: { readonly kit: FormDestinationKit; readonly forms: readonly FormDestinationForm[]; readonly credential?: FormDestinationCredential; readonly site: { readonly projectName: string } }, optional?: Record<string, never>): Promise<FormSubmissionsInspection>;
  /** External receivers only. Idempotently make the receiver exist and know the forms and key.
   *  Returns where browsers post. Runs at publish, after consent, before the hosting upload. */
  prepare?(required: { readonly kit: FormDestinationKit; readonly forms: readonly FormDestinationForm[]; readonly secret: string; readonly credential?: FormDestinationCredential; readonly site: { readonly projectName: string } }, optional?: Record<string, never>): Promise<{ readonly submitUrl: string }>;
  /** Pull model: one page of rows not yet acknowledged, oldest first. */
  pull?(required: { readonly kit: FormDestinationKit; readonly destination: FormDestinationAddress }, optional?: { readonly after?: number; readonly limit?: number }): Promise<FormDestinationPage>;
  /** Marks rows the host has durably imported, so they are no longer pending at the receiver. */
  ack?(required: { readonly kit: FormDestinationKit; readonly destination: FormDestinationAddress; readonly ids: readonly string[] }, optional?: Record<string, never>): Promise<{ readonly acknowledged: number }>;
  /** Push model (sheets, tables, email): one attempt of one binding's durable delivery job (the host app's `src/features/form-destinations/deliver.ts`).
   *  `credential` is resolved fresh per attempt from `binding.connectionRef` and is never stored in the
   *  job; `form`, `submission` and `binding` were frozen when the submission was planned (the source IP
   *  is never included). `idempotencyKey` is identical on every retry, so pass it to the destination
   *  when it can dedupe. Return nothing or `{ ok: true }` on success, or `{ ok: false, error }` with a
   *  `FormDeliveryErrorCode`; only that code is recorded, never a message, so a thrown error or an
   *  unknown code becomes a retryable `delivery-failed`. `binding`/`idempotencyKey` are optional in the
   *  type only so receive-only modules compile unchanged; the push path always passes them.
   *  `optional.state` is the plugin's read-only settings (e.g. a product turned off pauses delivery);
   *  other keys are host-supplied extras an adapter may read (`adapterOptions` of `createFormDestinationDeliverer`). */
  deliver?(required: { readonly kit: FormDestinationKit; readonly credential: FormDestinationCredential; readonly form: FormDestinationForm; readonly submission: { readonly id: string; readonly answers: Readonly<Record<string, unknown>>; readonly submittedAt: string }; readonly binding?: FormDeliveryBinding; readonly idempotencyKey?: string }, optional?: { readonly state?: FormDestinationPluginState } & Readonly<Record<string, unknown>>): Promise<void | FormDeliveryResult>;
}

/** One entry of a plugin's form-destinations file. */
export interface FormDestinationDescriptor {
  readonly id: string;
  readonly label: string;
  /** Plugin-relative path of the `.mjs` module. */
  readonly module: string;
  /** Absent: the destination does not receive browser posts (push delivery only). */
  readonly receive?: "co-hosted" | "external";
  /** Hosting target ids whose deployment carries this receiver. Non-empty when `co-hosted`. */
  readonly hosts?: readonly string[];
  /** Exact `custom_credential_sets` label of the destination's own vendor credential. */
  readonly credentialLabel?: string;
}
export interface LoadedFormDestination {
  readonly descriptor: FormDestinationDescriptor;
  readonly pluginId: string;
  readonly module: FormDestinationModule;
}
export interface FormDestinationRegistry {
  /** Every loaded destination, in a stable order (plugin id, then declaration order). */
  list(): readonly LoadedFormDestination[];
  get(id: string): LoadedFormDestination | undefined;
  /** The destination a saved key's scope names: the one whose id is the scope, or the co-hosted one
   *  whose `hosts` holds it (a hosting target id). Unique by the registry's dropped-for-both rule. */
  resolve(required: { readonly scope: string }, optional?: Record<string, never>): LoadedFormDestination | undefined;
  /** Log-safe, one sentence per plugin or destination that was NOT loaded, and why. */
  readonly refusals: readonly string[];
}


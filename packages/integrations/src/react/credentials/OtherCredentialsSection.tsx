import { forwardRef, useRef, type RefObject } from "react";
import { agentHandle, agentHandleSegment } from "@jini-ai/core/agent-handles";

import type { OtherCredentialStoreInfo } from "./other-credential-stores.js";
import type { OtherCredentialRowState, useOtherCredentialRemoveDialog } from "./OtherCredentialsSection.hooks.js";
import { rowHandleBase } from "./OtherCredentialsSection.hooks.js";

import { formatTimestamp, type Translate } from '@jini-ai/core/text';

type OtherCredentialsController = { t: Translate; remove: (row: OtherCredentialRowState) => Promise<void> };

/**
 * @file Tier 2 of the Access Tokens list — {@link OtherCredentialEntry}, the one top-level entry
 * component for the six single-row/per-item credential stores (`rules.ts`'s
 * `OTHER_CREDENTIAL_STORES`), rendered inline in the SAME merged, sorted list Tier 1's provider
 * groups render in, per the 2026-08-16 owner ruling ("one list, not two surfaces") and the
 * 2026-09-21 round-2 ruling that made it one TRUE ordered list rather than "Tier 1 sorted, Tier 2
 * always appended after". `AccessTokensTab.hooks.tsx`'s `useMergedSecretsOrder` owns the visibility
 * check and the per-store explosion into individual entries that this file used to own itself
 * (`OtherCredentialsSection`/`MaybeOtherCredentialGroup`/`OtherCredentialGroup`, deleted this pass —
 * see that hook's own doc for where the identical logic now lives); `AccessTokensTab.tsx` renders
 * this component directly, one call per merged entry.
 *
 * ## Why a Tier-2 "entry" has no separate parent heading the way a Tier-1 provider group does
 *
 * Tier 1's `ProviderGroup` shows one `<h3>` (the PROVIDER's name, e.g. "GitHub") with multiple named
 * `TokenRow`s underneath it, because one provider can hold several operator-named tokens. Nothing on
 * Tier 2 is named that way — `media-provider`/`external-mcp` can each hold more
 * than one ITEM (a provider, a server), but never more than one CREDENTIAL per item, so
 * there is nothing to nest. The owner's own mock reflects this directly: "Cloudinary (media)" reads
 * at the SAME indentation as the hosting/source-control providers, not nested under a "Media provider keys" parent —
 * each configured item (or, when a store has none configured, the store itself) gets its own
 * top-level entry, heading and all. {@link OtherCredentialEntry} is that entry; it structurally
 * mirrors `ProviderGroup` (one heading, one row) with exactly zero or one row inside, never more.
 */

function entryHandleLabel({ name, purposeLabel, configured }: { name: string; purposeLabel: string; configured: boolean }, _optional: Record<string, never> = {}): string {
  return configured ? `${name} — ${purposeLabel}, configured` : `${name} — ${purposeLabel}, not configured`;
}

/** One top-level Tier-2 entry — see this file's header for why this has no separate parent heading
 *  the way a Tier-1 `ProviderGroup` does. `row` is `undefined` for the not-configured placeholder.
 *  Exported (2026-09-21 round 2): `AccessTokensTab.tsx` now mounts this directly, one call per
 *  `useMergedSecretsOrder` entry, in place of the deleted `OtherCredentialsSection` wrapper. */
export function OtherCredentialEntry({ store, row, controller, deps }: { store: OtherCredentialStoreInfo; row: OtherCredentialRowState | undefined; controller: OtherCredentialsController;
  deps: {
    useAdminLocaleHook: () => string;
    useOtherCredentialRemoveDialogHook: typeof useOtherCredentialRemoveDialog;
    removeDialogTitle: (required: { locale: string; name: string }) => string;
    otherCredentialRemoveDialogBody: (required: { locale: string; store: OtherCredentialStoreInfo }) => string;
    VIEWER_TIME_ZONE: string | undefined;
    /** "Remove from Tovu," never "Revoke": removal forgets the stored copy, the provider keeps the key. */
    REMOVE_FROM_TOVU: string;
    removeHandleLabel: (required: { name: string }) => string;
  };
}, _optional = {}) {
  const translate = controller.t;
  const name = row?.name ?? translate(store.label);
  return (
    <section
      className="access-tokens-provider-group"
      {...agentHandle({ handle: `security-other-credentials-${store.id}-${agentHandleSegment({ value: row?.itemId ?? "none" })}` }, {
        role: "region",
        label: entryHandleLabel({ name, purposeLabel: store.purposeLabel, configured: row !== undefined }),
      })}
    >
      <h3 className="access-tokens-provider-heading">
        <span translate="no">{name}</span>
        <span className="access-tokens-provider-purpose"> · {translate(store.purposeLabel)}</span>
      </h3>
      <OtherCredentialEntryBody store={store} row={row} controller={controller} deps={deps} />
    </section>
  );
}

/** The entry's body — placeholder / static-configured / replaceable-configured, split out purely for
 *  the complexity gate (this repo's hard 9/9 cyclomatic/cognitive ceiling — `eslint.config.mjs`'s
 *  `F06 option B`). */
function OtherCredentialEntryBody({ store, row, controller, deps }: { store: OtherCredentialStoreInfo; row: OtherCredentialRowState | undefined; controller: OtherCredentialsController; deps: Parameters<typeof OtherCredentialEntry>[0]["deps"] }) {
  if (row === undefined) return <OtherCredentialPlaceholderRow store={store} t={controller.t} />;
  if (store.supportsReplace) return <OtherCredentialReplaceableRow row={row} controller={controller} deps={deps} />;
  return <OtherCredentialStaticRow row={row} controller={controller} deps={deps} />;
}

/** @param handleSuffix - Distinguishes this deep link from every other row's — a bare store id for
 *  the unconfigured placeholder (only one ever renders per store) or {@link rowHandleBase} for a
 *  real row, since a store like `media-provider` can hold more than one configured item. */
function DeepLink({ store, handleSuffix, t: translate }: { store: OtherCredentialStoreInfo; handleSuffix: string; t: Translate }) {
  return (
    <a
      className="btn-secondary"
      href={`/admin${store.screenPath}`}
      {...agentHandle({ handle: `security-other-credentials-manage-${handleSuffix}` }, {
        role: "link",
        label: `Open ${store.screenLabel} to manage this credential`,
      })}
    >
      {translate("Manage on")} {translate(store.screenLabel)} ↗
    </a>
  );
}

/** Nothing configured yet — same "always show it, invite the reader to go set it up" role Tier 1's
 *  `NotConnectedRow` plays, minus a `[Connect]` affordance: Tier 2 owns no Create flow (`rules.ts`'s
 *  own header on why), so the deep link IS this row's only action. */
function OtherCredentialPlaceholderRow({ store, t: translate }: { store: OtherCredentialStoreInfo; t: Translate }) {
  return (
    <div className="access-tokens-row">
      <div className="access-tokens-row-summary">
        <span className="access-tokens-row-marker" aria-hidden="true" />
        <span className="access-tokens-row-name">{translate("Not configured")}</span>
      </div>
      <div className="access-tokens-row-actions">
        <DeepLink store={store} handleSuffix={store.id} t={translate} />
      </div>
    </div>
  );
}

function OtherCredentialRemoveButton({ row, translate, dialogRef, deps }: { row: OtherCredentialRowState; translate: Translate; dialogRef: RefObject<HTMLDialogElement | null>; deps: Parameters<typeof OtherCredentialEntry>[0]["deps"] }) {
  return (
    <>
      <button
        type="button"
        className="btn-danger"
        onClick={() => dialogRef.current?.showModal()}
        // `aria-label`: a store can hold more than one configured item (this file's own
        // `handleSuffix` doc comment above names `media-provider` as an example), and every row
        // renders unconditionally — no accordion, no menu — so two configured items under the
        // same store put two identically-labeled "Remove from Tovu" buttons on screen at once.
        // `row.name` is this row's own display name, already visible in its heading.
        aria-label={`${translate(deps.REMOVE_FROM_TOVU)} — ${row.name}`}
        {...agentHandle({ handle: `security-other-credentials-remove-${rowHandleBase({ row })}` }, { role: "button", label: deps.removeHandleLabel({ name: row.name }) })}
      >
        {translate(deps.REMOVE_FROM_TOVU)}
      </button>
      {row.error ? (
        <p className="save-error" role="alert">
          {row.error}
        </p>
      ) : null}
    </>
  );
}

/** Configured, but this store does not support inline Replace (`external-mcp`
 *  — see `rules.ts`'s `OtherCredentialStoreInfo.supportsReplace` doc for why) — just the value fact,
 *  Remove, and the deep link, no disclosure to expand. Remove asks first, through the same
 *  {@link OtherCredentialRemoveDialog} the replaceable row uses: this store is the most
 *  destructive on the page (an External MCP delete loses a sealed OAuth secret for good), and this button used to fire on the first click. */
function OtherCredentialStaticRow({ row, controller, deps }: { row: OtherCredentialRowState; controller: OtherCredentialsController; deps: Parameters<typeof OtherCredentialEntry>[0]["deps"] }) {
  const translate = controller.t;
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <div className="access-tokens-row access-tokens-row-done access-tokens-row-static">
      <div className="access-tokens-row-summary">
        <span className="access-tokens-row-marker access-tokens-row-marker-done" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6" /></svg>
        </span>
        <span className="access-tokens-row-fact">{row.valueFact}</span>
        {row.updatedAt ? (
          <span className="access-tokens-row-summary-meta">
            {translate("saved")} {formatTimestamp({ iso: row.updatedAt }, { viewerTimeZone: deps.VIEWER_TIME_ZONE })}
          </span>
        ) : null}
      </div>
      <div className="access-tokens-row-actions">
        <DeepLink store={row.store} handleSuffix={rowHandleBase({ row })} t={translate} />
        <OtherCredentialRemoveButton row={row} translate={translate} dialogRef={dialogRef} deps={deps} />
      </div>
      <OtherCredentialRemoveDialog ref={dialogRef} row={row} controller={controller} t={translate} deps={deps} />
    </div>
  );
}

/** Configured, and this store supports retyping the key on its own dedicated screen (`DeepLink`) —
 *  always rendered open, no accordion: unlike Tier 1's `TokenRow`, there is no inline form here worth
 *  hiding behind a click. The Access token field shown below is the same masked `row.valueFact` the
 *  summary line already carries, rendered `disabled` — a natural, familiar "this is set, go elsewhere
 *  to change it" cue, not an editable draft. Deliberately carries no `agentHandle()` — a disabled
 *  field tagged as fillable would have an assistant try to type into it, find it inert, and get stuck;
 *  the `DeepLink` below is the one actionable path to actually change this value, same as a person
 *  reading this row would use. */
function OtherCredentialReplaceableRow({ row, controller, deps }: { row: OtherCredentialRowState; controller: OtherCredentialsController; deps: Parameters<typeof OtherCredentialEntry>[0]["deps"] }) {
  const translate = controller.t;
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <div className="access-tokens-row">
      {/* One shared block, not two independent rows — `align-items: stretch` in a column-direction
          inline-flex makes the (naturally narrow) token field stretch to match the actions row's own
          content width below it, so both edges line up instead of the field looking arbitrarily
          short next to a wider button group. */}
      <div className="access-tokens-row-block">
        <div className="access-tokens-row-fields access-tokens-row-fields-top">
          <div className="field">
            <label className="field-label" htmlFor={`security-other-credential-${rowHandleBase({ row })}`}>
              {translate("Access token")}
              {row.updatedAt ? (
                <span className="access-tokens-row-summary-meta access-tokens-field-label-meta">
                  {translate("saved")} {formatTimestamp({ iso: row.updatedAt }, { viewerTimeZone: deps.VIEWER_TIME_ZONE })}
                </span>
              ) : null}
            </label>
            {/* `type="text"`, not `"password"` — `row.valueFact` is already a pre-masked display
                string (leading dots + last 4 real characters); a password-type input would mask the
                last 4 a second time, hiding the one part of this value that's meant to stay visible. */}
            <input
              id={`security-other-credential-${rowHandleBase({ row })}`}
              className="access-tokens-row-field-disabled"
              type="text"
              autoComplete="off"
              value={row.valueFact}
              disabled
            />
          </div>
        </div>
        <div className="access-tokens-row-actions access-tokens-row-actions-top">
          <DeepLink store={row.store} handleSuffix={rowHandleBase({ row })} t={translate} />
          <OtherCredentialRemoveButton row={row} translate={translate} dialogRef={dialogRef} deps={deps} />
        </div>
      </div>
      <OtherCredentialRemoveDialog ref={dialogRef} row={row} controller={controller} t={translate} deps={deps} />
    </div>
  );
}

/**
 * Native `<dialog>` confirm, mirroring Tier 1's `RemoveConfirmDialog` — same "Remove from Tovu,
 * never Revoke" load-bearing copy constraint (`rules.ts`'s own header) for the four replaceable
 * stores: deleting Tovu's row does not revoke the credential at the provider, and this dialog is the
 * one place that fact gets stated in words. The two static-row stores state their own, different
 * fact instead (`otherCredentialRemoveDialogBody`). No equivalent "this is the last row for this provider" note: every Tier-2 store
 * already caps at one row per item, so removing it is always the only-row case — the sentence would
 * be true on every single Remove and therefore say nothing new.
 *
 * Confirm button carries no `agentHandle`, same destructive-action boundary Tier 1's own confirm
 * dialog draws.
 */
const OtherCredentialRemoveDialog = forwardRef<HTMLDialogElement, { row: OtherCredentialRowState; controller: OtherCredentialsController; t: Translate;
  deps: Parameters<typeof OtherCredentialEntry>[0]["deps"]; }>(
  function OtherCredentialRemoveDialog({ row, controller, t: translate, deps }, ref) {
    const locale = deps.useAdminLocaleHook();
    const { close, confirm } = deps.useOtherCredentialRemoveDialogHook({ ref, row, controller });
    // `aria-labelledby`, not left implicit — same fix, same reasoning, as Tier 1's own
    // `RemoveConfirmDialog` (`AccessTokensTab.tsx`): a native `<dialog>` gets no accessible name
    // for free from an `<h2>` inside it, and this doc comment's own header already promises this
    // dialog "mirrors Tier 1's `RemoveConfirmDialog` exactly" — this brings that true for the title
    // link too. `rowHandleBase({ row })` (already this row's DOM-id-safe base, used below by its own
    // input/deep-link ids) keeps this id unique across every Tier-2 row's own dialog.
    const titleId = `security-other-credentials-remove-title-${rowHandleBase({ row })}`;
    return (
      <dialog ref={ref} className="confirm-dialog" aria-labelledby={titleId}>
        <h2 id={titleId}>{deps.removeDialogTitle({ locale, name: row.name })}</h2>
        {/* Per-store body — `otherCredentialRemoveDialogBody`'s own doc: the shared "does NOT
            revoke" sentence is kept for the replaceable stores; External MCP gets its own. */}
        <p className="confirm-dialog-body">{deps.otherCredentialRemoveDialogBody({ locale, store: row.store })}</p>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            onClick={close}
            {...agentHandle({ handle: `security-other-credentials-remove-cancel-${rowHandleBase({ row })}` }, { role: "button", label: "Close this dialog without removing the credential" })}
          >
            {translate("Cancel")}
          </button>
          <button type="button" className="btn-danger" onClick={confirm}>
            {translate(deps.REMOVE_FROM_TOVU)}
          </button>
        </div>
      </dialog>
    );
  }
);

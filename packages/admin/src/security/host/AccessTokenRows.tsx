import { useRef } from "react";
import { agentHandle, agentHandleSegment } from "@jini-ai/core/agent-handles";
import { formatTimestamp, type Translate } from "@jini-ai/core/text";
import { sharedKeyReplaceWarning } from "../security-i18n.js";
import type { AccessTokenProviderRef } from "../access-token-rows.js";
import { type AccessTokenProviderInfo } from "../access-token-providers.js";
import type { AccessTokenAddFormState, AccessTokenExistingRowState, AccessTokensController } from "./hooks/use-access-tokens.hooks.js";
import type { AccessTokensTabBindings } from "./AccessTokensTab.js";
import { TokenInputFields, WorksForField } from "./AccessTokenFields.js";
import { RemoveConfirmDialog } from "./AccessTokenDialogs.js";

export function TokenRow({ bindings,
  state,
  info,
  controller,
  groupRowCount,
  t: translate,
}: { bindings: AccessTokensTabBindings;
  state: AccessTokenExistingRowState;
  info: AccessTokenProviderInfo;
  controller: AccessTokensController;
  groupRowCount: number;
  t: Translate;
}) {

  const { removeLabel, tokenRowHandleLabel } = bindings.deps;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const showDefaultUi = groupRowCount >= 2;
  return (
    <details
      className="access-tokens-row access-tokens-row-done"
      {...agentHandle({ handle: `security-access-tokens-row-${state.row.kind}-${agentHandleSegment({ value: state.row.providerId })}-${agentHandleSegment({ value: state.row.id })}` }, {
        role: "region",
        label: tokenRowHandleLabel({ name: state.name, providerLabel: info.label }),
      })}
    >
      <TokenRowSummary bindings={bindings} state={state} info={info} controller={controller} showDefaultUi={showDefaultUi} translate={translate} />
      {state.row.scope === "project" && !state.row.usedByThisSite ? (
        <div className="access-tokens-row-actions">
          <p className="field-hint">{translate("Use on this site to replace this key.")}</p>
          <button type="button" className="btn-danger" onClick={() => dialogRef.current?.showModal()} aria-label={`${translate(removeLabel)} — ${state.name}`}>
            {translate(removeLabel)}
          </button>
        </div>
      ) : <ExistingTokenFields bindings={bindings} state={state} controller={controller} info={info} onRemoveClick={() => dialogRef.current?.showModal()} t={translate} />}
      <RemoveConfirmDialog bindings={bindings} ref={dialogRef} row={state.row} info={info} controller={controller} isLastForProvider={groupRowCount === 1} t={translate} />
    </details>
  );
}

/** Storage and attachment facts for custom keys. Summary actions preserve the disclosure state,
 * matching the existing default-token action; the controller owns all I/O and failures.
 */
function CustomKeyUsage({ state, controller }: { state: AccessTokenExistingRowState; controller: AccessTokensController }) {

  if (state.row.kind !== "custom") return null;
  const translate = controller.t;
  if (state.row.scope !== "project") return <span className="status status-neutral">{translate("This site only")}</span>;
  const sites = state.row.usedBy ?? [];
  const action = state.row.usedByThisSite ? "Stop using on this site" : "Use on this site";
  return <>
    <span className="status status-neutral">
      {sites.length ? <>{translate("Project — used by:")} <span translate="no">{sites.join(", ")}</span></> : translate("Project — not used by any site yet")}
    </span>
    <button type="button" className="link-button" disabled={controller.customKeyBusy[state.row.id]?.saving}
      aria-label={`${translate(action)} — ${state.name}`}
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        void controller.setCustomKeyUse({ row: state.row, use: !state.row.usedByThisSite });
      }}
      {...agentHandle({ handle: `security-access-tokens-use-${agentHandleSegment({ value: state.row.id })}` }, { role: "button", label: `${action} — ${state.name}` })}
    >{translate(action)}</button>
    <span className="field-hint">{translate("Access is revoked within 30 seconds.")}</span>
    {controller.customKeyBusy[state.row.id]?.error ? <span className="save-error" role="alert">{controller.customKeyBusy[state.row.id].error}</span> : null}
  </>;
}

/** The `isDefault` indicator + `Make default` link — only shown once a provider has 2+ saved
 *  tokens (`rules.ts`'s own doc on why a lone row has nothing to choose between). Split out purely
 *  for the complexity gate.
 *
 * This button lives inside `TokenRow`'s own `<summary>`, a descendant of the native disclosure
 * toggle, so its click would otherwise ALSO open/close the enclosing `<details>` (the browser runs
 * `<summary>`'s toggle as the click event's default action regardless of which descendant was
 * actually clicked, unless that default action is cancelled) — `preventDefault`/`stopPropagation`
 * in the handler below is what keeps a "Make default" click from also expanding the row, same
 * pattern as `deployment/StaticSiteTab.tsx`'s `CredentialVerifyAction`. */
function TokenRowDefaultIndicator({ state, showDefaultUi, controller, t: translate }: { state: AccessTokenExistingRowState; showDefaultUi: boolean; controller: AccessTokensController; t: Translate }) {

  if (!showDefaultUi) return null;
  if (state.row.isDefault) return <span className="status status-neutral">{translate("Default")}</span>;
  return (
    <button
      type="button"
      className="link-button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void controller.makeDefault(state.row);
      }}
      // `aria-label`, not just the visible "Make default" text: this button renders once per
      // non-default row in a provider group that has 2+ saved tokens (the ONLY case it renders at
      // all — this function's own guard above), so with 3+ saved tokens for one provider, multiple
      // identically-labeled "Make default" buttons are on screen simultaneously. `state.name` is
      // this row's own operator-chosen display name, already unique enough to pick one out.
      aria-label={`${translate("Make default")} — ${state.name}`}
      {...agentHandle({ handle: `security-access-tokens-default-${agentHandleSegment({ value: state.row.id })}` }, { role: "button", label: `Make ${state.name} the default token` })}
    >
      {translate("Make default")}
    </button>
  );
}

function ExistingTokenFields({ bindings,
  state,
  controller,
  info,
  onRemoveClick,
  t: translate,
}: { bindings: AccessTokensTabBindings;
  state: AccessTokenExistingRowState;
  controller: AccessTokensController;
  info: AccessTokenProviderInfo;
  onRemoveClick: () => void;
  t: Translate;
}) {

  const readyToSave = state.readyToSave;
  return (
    <>
      <TokenInputFields bindings={bindings}
        idPrefix={`security-existing-${agentHandleSegment({ value: state.row.id })}`}
        info={info}
        name={state.name}
        token={state.token}
        values={state.values}
        username={state.username}
        onNameChange={(v) => controller.setExistingField({ rowId: state.row.id, patch: { name: v } })}
        onTokenChange={(v) => controller.setExistingField({ rowId: state.row.id, patch: { token: v } })}
        onFieldChange={(name, v) => controller.setExistingField({ rowId: state.row.id, patch: { values: { ...state.values, [name]: v } } })}
        onUsernameChange={(v) => controller.setExistingField({ rowId: state.row.id, patch: { username: v } })}
        connected
        t={translate}
      />
      {info.kind !== "source-control" ? <WorksForField bindings={bindings} value={state.worksFor} options={controller.worksForOptions} onChange={worksFor => controller.setExistingField({ rowId: state.row.id, patch: { worksFor } })} t={translate} /> : null}
      <SharedKeyReplaceNote row={state.row} t={translate} />
      <ExistingTokenActions bindings={bindings} state={state} info={info} controller={controller} onRemoveClick={onRemoveClick} readyToSave={readyToSave} translate={translate} />
    </>
  );
}

/** Warns, before Save, that a shared project key's other sites switch to the new token too. */
function SharedKeyReplaceNote({ row, t: translate }: { row: AccessTokenExistingRowState["row"]; t: Translate }) {

  const warning = row.scope === "project" ? sharedKeyReplaceWarning({ usedBy: row.usedBy, usedByThisSite: row.usedByThisSite, t: translate }) : null;
  return warning ? <p className="save-warning">{warning}</p> : null;
}

export function AddTokenForm({ bindings, info, state, controller, t: translate }: { bindings: AccessTokensTabBindings; info: AccessTokenProviderInfo; state: AccessTokenAddFormState; controller: AccessTokensController; t: Translate }) {

  const ref: AccessTokenProviderRef = { kind: info.kind, providerId: info.providerId };
  const readyToSave = state.readyToSave;
  return (
    <div className="access-tokens-row">
      <TokenInputFields bindings={bindings}
        idPrefix={`security-add-${info.kind}-${agentHandleSegment({ value: info.providerId })}`}
        info={info}
        name={state.name}
        token={state.token}
        values={state.values}
        username={state.username}
        onNameChange={(v) => controller.setAddField(ref, { name: v })}
        onTokenChange={(v) => controller.setAddField(ref, { token: v })}
        onFieldChange={(name, v) => controller.setAddField(ref, { values: { ...state.values, [name]: v } })}
        onUsernameChange={(v) => controller.setAddField(ref, { username: v })}
        connected={false}
        t={translate}
      />
      {info.kind === "publish" ? <WorksForField bindings={bindings} value={state.worksFor} options={controller.worksForOptions} onChange={worksFor => controller.setAddField(ref, { worksFor })} t={translate} /> : null}
      <AddTokenActions state={state} info={info} controller={controller} ref={ref} readyToSave={readyToSave} translate={translate} />
    </div>
  );
}

function TokenRowSummary({ bindings, state, info, controller, showDefaultUi, translate }: Pick<Parameters<typeof TokenRow>[0], "bindings" | "state" | "info" | "controller"> & { showDefaultUi: boolean; translate: Translate }, _optional: Record<string, never> = {}) {
  const { CredentialHint, ConnectedMarkIcon, DisclosureChevronIcon } = bindings.kit;
  const { viewerTimeZone } = bindings.deps;
  return (
<summary className="access-tokens-row-summary">
        <span className="access-tokens-row-marker access-tokens-row-marker-done" aria-hidden="true">
          <ConnectedMarkIcon />
        </span>
        <span className="access-tokens-row-name">{state.name}</span>
        <CustomKeyUsage state={state} controller={controller} />
        <TokenRowDefaultIndicator state={state} showDefaultUi={showDefaultUi} controller={controller} t={translate} />
        <span className="access-tokens-row-summary-meta">
          {state.row.worksFor?.length ? <span>{translate("Works for")}: {state.row.worksFor.join(", ")} · </span> : null}
          {translate("saved")} {formatTimestamp({ iso: state.row.updatedAt }, { viewerTimeZone: viewerTimeZone })} <CredentialHint hint={state.row.tokenHint} />
        </span>
        <span className="access-tokens-row-summary-expand">
          {translate(state.row.scope === "project" && !state.row.usedByThisSite ? "Details" : "Replace token")}
          <DisclosureChevronIcon />
        </span>
      </summary>
  );
}

function ExistingTokenActions({ bindings, state, info, controller, onRemoveClick, readyToSave, translate }: Pick<Parameters<typeof ExistingTokenFields>[0], "bindings" | "state" | "info" | "controller" | "onRemoveClick"> & { readyToSave: boolean; translate: Translate }, _optional: Record<string, never> = {}) {
  const { removeLabel, removeTokenHandleLabel } = bindings.deps;
  return (
<div className="access-tokens-row-actions">
        <button
          type="button"
          disabled={!readyToSave || state.saving}
          onClick={() => void controller.replaceToken(state.row)}
          // `aria-label`, not just the visible "Save"/"Saving…" text: a provider group can hold
          // several saved tokens (`AddAnotherButton` above), each opened via its own `<details>`
          // (unlike `RowMenu`'s exclusive-open items, more than one can be expanded at once) — with
          // two rows open, both show an identical bare "Save" button. `state.name` is this row's own
          // display name, already visible in its `<summary>` heading, so it disambiguates the same
          // way a sighted reader already can. Mirrors the visible text's own saving/idle split so the
          // accessible name never says "Save" while the button reads "Saving…" (WCAG 2.5.3).
          aria-label={`${state.saving ? translate("Saving…") : translate("Save")} — ${state.name}`}
          {...agentHandle({ handle: `security-access-tokens-save-${agentHandleSegment({ value: state.row.id })}` }, { role: "button", label: `Save this ${info.label} token` })}
        >
          {state.saving ? translate("Saving…") : translate("Save")}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={onRemoveClick}
          // Same multi-row-open ambiguity as Save above, on this page's one destructive action —
          // see `rules.ts`'s `restoreButtonAccessibleName` (`recovery/rules.ts`) for the identical
          // reasoning applied to a different screen's own always-visible destructive control.
          aria-label={`${translate(removeLabel)} — ${state.name}`}
          {...agentHandle({ handle: `security-access-tokens-remove-${agentHandleSegment({ value: state.row.id })}` }, { role: "button", label: removeTokenHandleLabel({ provider: info.label }) })}
        >
          {translate(removeLabel)}
        </button>
        {state.error ? (
          <p className="save-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
  );
}

function AddTokenActions({ state, info, controller, ref, readyToSave, translate }: Pick<Parameters<typeof AddTokenForm>[0], "state" | "info" | "controller"> & { ref: AccessTokenProviderRef; readyToSave: boolean; translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="access-tokens-row-actions">
        <button
          type="button"
          disabled={!readyToSave || state.saving}
          onClick={() => void controller.createToken(ref)}
          // `aria-label`: more than one provider's "Add" form can be open at once (each provider
          // group owns its own independent `addForm.visible`), and every one of them renders this
          // same bare "Save"/"Saving…" text — `info.label` is the one thing that tells them apart
          // here (there is no operator-chosen name yet to use, unlike `ExistingTokenFields`' own
          // fix above, since this token has not been saved).
          aria-label={`${state.saving ? translate("Saving…") : translate("Save")} — ${info.label}`}
          {...agentHandle({ handle: `security-access-tokens-create-${info.kind}-${agentHandleSegment({ value: info.providerId })}` }, { role: "button", label: `Save this ${info.label} token` })}
        >
          {state.saving ? translate("Saving…") : translate("Save")}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => controller.closeAddForm(ref)}
          aria-label={`${translate("Cancel")} adding this ${info.label} token`}
          {...agentHandle({ handle: `security-access-tokens-cancel-${info.kind}-${agentHandleSegment({ value: info.providerId })}` }, { role: "button", label: "Close this add-token form without saving" })}
        >
          {translate("Cancel")}
        </button>
        {state.error ? (
          <p className="save-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
  );
}

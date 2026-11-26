import { forwardRef } from "react";
import { agentHandle, agentHandleSegment } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";
import { SecretInput } from "../../shell/components/SecretInput/SecretInput.js";
import { removeDialogLastRowNote } from "../security-i18n.js";
import type { AccessTokenRowCategoryId, AccessTokenRow } from "../access-token-rows.js";
import { invalidAdditionalHostsEntries } from "../custom-credential-forms.js";
import { type AccessTokenProviderInfo } from "../access-token-providers.js";
import type { AccessTokensController } from "./hooks/use-access-tokens.hooks.js";
import type { AccessTokensTabBindings } from "./AccessTokensTab.js";
import { WorksForField } from "./AccessTokenFields.js";

/**
 * Native `<dialog>` confirm — same `.confirm-dialog` foundation `styles.css:2880` documents (`[open]`-
 * scoped `display`, never a bare-class rule — that comment's own header records the live bug an
 * unscoped rule caused). "Remove from the host," never "Revoke" — `rules.ts`'s own header, this page's
 * one load-bearing copy constraint: deleting the host's row does not revoke the credential at the
 * provider, and this dialog is the one place that fact has to be stated in words, not implied by a
 * button label.
 *
 * Confirm button carries no `agentHandle` — destructive, same boundary
 * `StaticSiteTab.tsx`'s own credential-entry fields already draw (no agent read/act surface over a
 * credential action); the row's own SUMMARY stays tagged (`TokenRow`'s `agentHandle`), only this
 * dialog's destructive action does not.
 */
export const RemoveConfirmDialog = forwardRef<HTMLDialogElement, { row: AccessTokenRow; info: AccessTokenProviderInfo; controller: AccessTokensController; isLastForProvider: boolean; t: Translate;
  bindings: AccessTokensTabBindings; }>(
  function RemoveConfirmDialog({ row, info, controller, isLastForProvider, t: translate,
  bindings }, ref) {
  const { useAdminLocaleHook, useRemoveConfirmDialogHook } = bindings.hooks;
  const { removeDialogTitle, removeDialogBody } = bindings.deps;

    const locale = useAdminLocaleHook();
    const { close, confirm } = useRemoveConfirmDialogHook({ ref, row, controller });
    // `aria-labelledby`, not left implicit: a native `<dialog>` has no accessible name of its own
    // from an `<h2>` sitting inside it — that link has to be stated, the same way the shared
    // `ConfirmDialog` (`@jini-ai/admin/react`) already does via its own `titleId`. Without it, every
    // one of this page's per-row remove dialogs reads to an accessibility tree as an unnamed
    // "dialog", indistinguishable from any other open dialog on the page. Scoped by `row.id` (not a
    // static id) because one `RemoveConfirmDialog` is mounted per token row, all in the DOM at once.
    const titleId = `security-access-tokens-remove-title-${agentHandleSegment({ value: row.id })}`;
    return (
      <dialog ref={ref} className="confirm-dialog" aria-labelledby={titleId}>
        <h2 id={titleId}>{removeDialogTitle({ locale, name: row.name })}</h2>
        <p className="confirm-dialog-body">{removeDialogBody({ locale, credentialLabel: info.label, vendor: info.vendorLabel })}</p>
        {info.tokenPageUrl === "" ? null : <p>
          {/* `info.vendorLabel`, NOT `info.label` — this line says WHERE to revoke, and "GitHub
              Pages"/"Cloudflare Pages" are destinations with no revoke console of their own. See
              `rules.ts`'s `AccessTokenProviderInfo.vendorLabel` doc for the full reasoning; every
              other `info.label` on this page still names the destination on purpose. */}
          <a
            href={info.tokenPageUrl}
            target="_blank"
            rel="noreferrer"
            {...agentHandle({ handle: `security-access-tokens-revoke-page-${agentHandleSegment({ value: row.id })}` }, { role: "link", label: `Open ${info.vendorLabel} to revoke this token at the source` })}
          >
            {translate("Revoke it on")} <span translate="no">{info.vendorLabel}</span> ↗
          </a>
        </p>}
        {isLastForProvider ? <p className="confirm-dialog-body">{removeDialogLastRowNote({ locale, provider: info.label })}</p> : null}
        <RemoveConfirmActions bindings={bindings} row={row} close={close} confirm={confirm} translate={translate} />
      </dialog>
    );
  }
);

/** The red-star marker on a required field's label — Name/API base URL/Access token in the form
 *  below (Username stays unmarked, Category always carries a value so it's never actually blank).
 *  `aria-label`, not `aria-hidden`, so a screen reader announces "required" — same convention
 *  `Authentication.tsx`'s own `source-config-field-required` marker uses. */
function RequiredFieldMarker() {
  return (
    <span className="access-tokens-field-required" aria-label="required">
      {" "}
      *
    </span>
  );
}

/** The "Additional hosts" field — split out of {@link AddCustomCredentialDialog} purely so that
 *  function's own complexity stays under this repo's gate; the inline-error branch below adds one
 *  more decision point to whichever function renders it, and `AddCustomCredentialDialog` already
 *  carries a full field set's worth. */
function AdditionalHostsField({ value, onChange, translate }: { value: string; onChange: (value: string) => void; translate: Translate }) {

  const invalid = invalidAdditionalHostsEntries({ raw: value });
  return (
    <div className="field">
      <label className="field-label" htmlFor="security-add-custom-additional-hosts">
        {translate("Additional hosts")}
      </label>
      <textarea
        id="security-add-custom-additional-hosts"
        rows={2}
        value={value}
        placeholder="https://secondary-api.example.test"
        onChange={(e) => onChange(e.target.value)}
        {...agentHandle({ handle: "security-access-tokens-add-custom-additional-hosts" }, {
          role: "field",
          label: "Extra API hosts this same credential is also allowed to call, beyond the base URL",
        })}
      />
      <p className="field-hint">
        {translate("Optional — some providers use more than one API host for the same account (e.g. api.example.test and secondary-api.example.test). One per line, or comma-separated.")}
      </p>
      {invalid.length > 0 ? <p className="field-error">{translate("Each additional host must be a valid http:// or https:// URL.")}</p> : null}
    </div>
  );
}

/** Local API keys live in Shared Keys; this site's selection is only a grant/reference. */
function CustomKeyStorageChoice({ controller }: { controller: AccessTokensController }) {

  return <p className="field-hint">{controller.t(controller.projectKeysAvailable ? "Save to project and use on this site" : "This site only")}</p>;
}

/**
 * The "Add custom provider" form (`AccessTokensCategoryFilter`'s own button opens it) — a
 * standalone native `<dialog>`, not a per-provider `AddTokenForm` (this file's own header on why a
 * custom row has no shared provider group to attach an inline add-form to). Collects the four
 * fields the brief specifies (API base URL, Access token with a show/hide toggle, optional
 * Username, Category) plus a Name field every other row on this page already requires (the display
 * name the list/search will show — `TokenInputFields`' own "Name" field doc gives the identical
 * reasoning). Deliberately does NOT reuse `TokenInputFields`: that shared component's field set
 * (Name/Token/AccountId/Username) has no Base URL or Category concept, and both of those are
 * create-only here (see `rules.ts`'s `accessTokenRowProviderInfo` doc for why Replace on an
 * existing custom row does not re-collect them) — bolting a fifth, create-only field onto a
 * component shared with the seven catalog providers' Replace flow would risk it leaking there too.
 */
export const AddCustomCredentialDialog = forwardRef<HTMLDialogElement, { controller: AccessTokensController; t: Translate;
  bindings: AccessTokensTabBindings; }>(
  function AddCustomCredentialDialog({ controller, t: translate, bindings }, ref) {
  const { useAddCustomCredentialDialogHook } = bindings.hooks;

    const { readyToSave, baseUrlInvalid, close, save } = useAddCustomCredentialDialogHook({ ref, controller });
    const form = controller.customAddForm;
    // Same `aria-labelledby` fix as `RemoveConfirmDialog` above — one instance of this dialog per
    // page, so a static id is fine (contrast the per-row `row.id`-scoped id there).
    const titleId = "security-access-tokens-add-custom-title";

    return (
      <dialog
        ref={ref}
        className="confirm-dialog access-tokens-add-custom-dialog"
        aria-labelledby={titleId}
        {...agentHandle({ handle: "security-access-tokens-add-custom-dialog" }, { role: "region", label: "Add a custom provider not in the built-in list" })}
      >
        <h2 id={titleId}>{translate("Add custom provider")}</h2>
        <CustomCredentialNameField controller={controller} form={form} translate={translate} />
        <CustomCredentialUrlField bindings={bindings} controller={controller} form={form} translate={translate} baseUrlInvalid={baseUrlInvalid} />
        <AdditionalHostsField
          value={form.additionalHosts}
          onChange={(value) => controller.setCustomAddField({ additionalHosts: value })}
          translate={translate}
        />
        <CustomCredentialTokenField controller={controller} form={form} translate={translate} />
        <CustomCredentialUsernameField controller={controller} form={form} translate={translate} />
        <CustomCredentialCategoryField bindings={bindings} controller={controller} form={form} translate={translate} />
        <CustomKeyStorageChoice controller={controller} />
        <WorksForField bindings={bindings} value={form.worksFor} options={controller.worksForOptions} onChange={worksFor => controller.setCustomAddField({ worksFor })} t={translate} />
        {form.error ? (
          <p className="save-error" role="alert">
            {form.error}
          </p>
        ) : null}
        <CustomCredentialActions readyToSave={readyToSave} form={form} close={close} save={save} translate={translate} />
      </dialog>
    );
  }
);

function RemoveConfirmActions({ bindings, row, close, confirm, translate }: { bindings: AccessTokensTabBindings; row: AccessTokenRow; close: () => void; confirm: () => void; translate: Translate }, _optional: Record<string, never> = {}) {
  const { removeLabel } = bindings.deps;
  return (
<div className="confirm-dialog-actions">
          <button
            type="button"
            onClick={close}
            {...agentHandle({ handle: `security-access-tokens-remove-cancel-${agentHandleSegment({ value: row.id })}` }, { role: "button", label: "Close this dialog without removing the token" })}
          >
            {translate("Cancel")}
          </button>
          <button type="button" className="btn-danger" onClick={confirm}>
            {translate(removeLabel)}
          </button>
        </div>
  );
}

function CustomCredentialNameField({ controller, form, translate }: { controller: AccessTokensController; form: AccessTokensController["customAddForm"]; translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="field">
          <label className="field-label" htmlFor="security-add-custom-name">
            {translate("Name")}
            <RequiredFieldMarker />
          </label>
          <input
            id="security-add-custom-name"
            type="text"
            value={form.name}
            onChange={(e) => controller.setCustomAddField({ name: e.target.value })}
            {...agentHandle({ handle: "security-access-tokens-add-custom-name" }, { role: "field", label: "This custom provider's display name, e.g. a registrar" })}
          />
          <p className="field-hint">{translate("A short label so you can tell this apart from your other saved credentials.")}</p>
        </div>
  );
}

function CustomCredentialUrlField({ bindings, controller, form, translate, baseUrlInvalid }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; form: AccessTokensController["customAddForm"]; translate: Translate; baseUrlInvalid: boolean }, _optional: Record<string, never> = {}) {
  return (
<div className="field">
          <label className="field-label" htmlFor="security-add-custom-base-url">
            {translate("API base URL")}
            <RequiredFieldMarker />
          </label>
          <input
            id="security-add-custom-base-url"
            type="url"
            value={form.baseUrl}
            placeholder={bindings.deps.customCredentialBaseUrlPlaceholder}
            onChange={(e) => controller.setCustomAddField({ baseUrl: e.target.value })}
            {...agentHandle({ handle: "security-access-tokens-add-custom-base-url" }, { role: "field", label: "This provider's API base URL" })}
          />
          {baseUrlInvalid ? <p className="field-error">{translate("Enter a valid http:// or https:// URL.")}</p> : null}
        </div>
  );
}

function CustomCredentialTokenField({ controller, form, translate }: { controller: AccessTokensController; form: AccessTokensController["customAddForm"]; translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="field">
          <label className="field-label" htmlFor="security-add-custom-token">
            {translate("Access token")}
            <RequiredFieldMarker />
          </label>
          <SecretInput
            label={translate("Access token")}
            id="security-add-custom-token"
            autoComplete="new-password"
            value={form.token}
            onChange={(e) => controller.setCustomAddField({ token: e.target.value })}
            {...agentHandle({ handle: "security-access-tokens-add-custom-token" }, { role: "field", label: "This provider's access token" })}
            toggleAttrs={agentHandle({ handle: "security-access-tokens-add-custom-token-toggle" }, { role: "button", label: "Show or hide the access token" })}
          />
          <p className="field-hint">{translate("This will not be shown again for security purposes.")}</p>
        </div>
  );
}

function CustomCredentialUsernameField({ controller, form, translate }: { controller: AccessTokensController; form: AccessTokensController["customAddForm"]; translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="field">
          <label className="field-label" htmlFor="security-add-custom-username">
            {translate("Username")}
          </label>
          <input
            id="security-add-custom-username"
            type="text"
            value={form.username}
            onChange={(e) => controller.setCustomAddField({ username: e.target.value })}
            {...agentHandle({ handle: "security-access-tokens-add-custom-username" }, { role: "field", label: "This provider's username, if it authenticates a token against one" })}
          />
          <p className="field-hint">{translate("Optional — only needed if this provider authenticates a token against a username.")}</p>
        </div>
  );
}

function CustomCredentialCategoryField({ bindings, controller, form, translate }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; form: AccessTokensController["customAddForm"]; translate: Translate }, _optional: Record<string, never> = {}) {
  const { ACCESS_TOKEN_CATEGORIES } = bindings.deps;
  return (
<div className="field">
          <label className="field-label" htmlFor="security-add-custom-category">
            {translate("Category")}
          </label>
          <select
            id="security-add-custom-category"
            value={form.category}
            onChange={(e) => controller.setCustomAddField({ category: e.target.value as AccessTokenRowCategoryId })}
            {...agentHandle({ handle: "security-access-tokens-add-custom-category" }, { role: "field", label: "Which category this credential is filed under" })}
          >
            {ACCESS_TOKEN_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
              <option key={c.id} value={c.id}>
                {translate(c.label)}
              </option>
            ))}
          </select>
        </div>
  );
}

function CustomCredentialActions({ readyToSave, form, close, save, translate }: { readyToSave: boolean; form: AccessTokensController["customAddForm"]; close: () => void; save: () => Promise<void>; translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="confirm-dialog-actions">
          <button
            type="button"
            onClick={close}
            {...agentHandle({ handle: "security-access-tokens-add-custom-cancel" }, { role: "button", label: "Close this dialog without saving a custom provider" })}
          >
            {translate("Cancel")}
          </button>
          <button
            type="button"
            disabled={!readyToSave || form.saving}
            onClick={() => void save()}
            {...agentHandle({ handle: "security-access-tokens-add-custom-save" }, { role: "button", label: "Save this custom provider credential" })}
          >
            {form.saving ? translate("Saving…") : translate("Save")}
          </button>
        </div>
  );
}

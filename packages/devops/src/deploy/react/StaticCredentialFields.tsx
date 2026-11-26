import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { PublishCredentialRowState, PublishCredentialsController } from "./hooks/use-publish-credentials.hooks.js";
import { credentialFieldHandleId, credentialFormReadyToSave, fieldHelpText, fieldLabelParts } from "./rules.js";
import type { AdminPublishTargetField } from "./rules.js";
import type { StaticSiteTabProps } from "./StaticSiteTab.js";

/**
 * Step 1's fields — token input, a host's required companion field (e.g. an account ID), and the Save action. Shared
 * between {@link CredentialStepTodo} (always open) and {@link CredentialStepDone} (one click away,
 * for replacing an already-saved token) rather than duplicated, since the fields and the Save
 * behavior are identical in both — only whether the reader sees them by default differs.
 *
 * Every hint here renders BELOW its input as a `.field-hint`, never as placeholder text inside it —
 * grey placeholder text sitting in an empty box reads as a saved value at a glance, which was the
 * owner's own "why is the access token prepopulated for Netlify and Cloudflare" complaint about this
 * section's earlier shape. The token and Account ID inputs below carry NO `placeholder` prop at all,
 * connected or not — an empty box always looks empty.
 *
 * Fields render in a single stacked column (`.deployment-credential-fields`), NOT the shared
 * `.field-row` two-up grid every target-config field set on this tab uses — that grid gives both
 * columns of a row the SAME height, and Cloudflare Pages' own two fields never have the same height
 * (Access token carries two hint lines plus a link; Account ID carries one short hint). A single
 * column can't break this way regardless of field count — see this file's header for the Custom/S3
 * provider (~5 fields) this same layout will need to hold once it lands.
 */
export function PublishCredentialFields({
  row,
  controller,
  t: translate,
 kit, deps }: {
  row: PublishCredentialRowState;
  controller: PublishCredentialsController;
  t: Translate;
} & Pick<StaticSiteTabProps, "kit" | "deps">, _optional = {}) {
  const readyToSave = credentialFormReadyToSave({ spec: row.credential, values: row.values });

  return (
    <>
      {fieldHelpText({ field: row.credential }) ? <p className="deployment-action-reason">{fieldHelpText({ field: row.credential })}</p> : null}
      <div className="deployment-credential-fields">
        {row.credential.fields.map((field) => (
          <CredentialFieldInput kit={kit} deps={deps} key={field.name} row={row} field={field} controller={controller} t={translate} />
        ))}
      </div>

      <div className="deployment-action">
        <button
          type="button"
          disabled={!readyToSave || row.saving}
          onClick={() => void controller.save(row.providerId)}
          {...agentHandle({ handle: `deployment-static-site-credentials-save-${row.providerId}` }, {
            role: "button",
            label: `Save the ${row.label} access token`,
          })}
        >
          {row.saving ? translate("Saving…") : translate("Save")}
        </button>
        {row.error ? (
          <p className="save-error" role="alert">
            {row.error}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** A field's label: the descriptor's own (a host term, rendered verbatim) plus the translated
 *  "(optional)" suffix when the field is optional. */
export function FieldLabel({ field, htmlFor, t: translate }: { field: AdminPublishTargetField; htmlFor: string; t: Translate }, _optional = {}) {
  const { label, suffixKey } = fieldLabelParts({ field: field });
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {label}
      {suffixKey ? ` ${translate(suffixKey)}` : null}
    </label>
  );
}

/** One credential input, rendered from the host's descriptor. The token field (`tokenField`) keeps
 *  the storage hint (blank keeps the saved token once connected) and the host's "Create a token"
 *  link; a secret field is a password input with `new-password` (Chrome ignores `off` on
 *  credential-shaped fields — see `security/AccessTokensTab.tsx`), any other field is plain text
 *  with `off`. No placeholders: grey text in an empty box reads as a saved value. */
function CredentialFieldInput({
  row,
  field,
  controller,
  t: translate,
 kit, deps }: {
  row: PublishCredentialRowState;
  field: AdminPublishTargetField;
  controller: PublishCredentialsController;
  t: Translate;
} & Pick<StaticSiteTabProps, "kit" | "deps">, _optional = {}) {
  const { SecretInput } = kit;
  const { asciiSlug } = deps;
  const id = credentialFieldHandleId({ asciiSlug, providerId: row.providerId, fieldName: field.name, tokenField: row.credential.tokenField });
  const isToken = field.name === row.credential.tokenField;
  return (
    <div className="field">
      <FieldLabel field={field} htmlFor={id} t={translate} />
      <SecretInput
        label={field.label}
        secret={field.secret === true}
        id={id}
        autoComplete="new-password"
        value={row.values[field.name] ?? ""}
        onChange={(e) => controller.setField({ providerId: row.providerId, fieldName: field.name, value: e.target.value })}
        {...agentHandle({ handle: id }, {
          role: "field",
          label: isToken ? `${row.label} access token — stored encrypted, never shown again once saved` : `${row.label} ${field.label}`,
        })}
      />
      {isToken ? <TokenFieldHints deps={deps} row={row} t={translate} /> : null}
      {fieldHelpText({ field }) ? <p className="field-hint">{fieldHelpText({ field })}</p> : null}
    </div>
  );
}

/** The token field's storage hint, plus the host's own token page when its descriptor names one
 *  (opened in a new tab: a third-party account-security page never renders inside this admin). */
function TokenFieldHints({ row, t: translate , deps }: { row: PublishCredentialRowState; t: Translate } & Pick<StaticSiteTabProps, "deps">, _optional = {}) {
  const { copy } = deps;
  const tokenPageUrl = row.credential.tokenPageUrl;
  return (
    <>
      <p className="field-hint">
        {row.saved !== undefined
          ? translate("Leave blank to keep the current token.")
          : translate(copy.storedTokenNotice)}
      </p>
      {tokenPageUrl ? (
        <p className="field-hint">
          <a
            href={tokenPageUrl}
            target="_blank"
            rel="noreferrer"
            {...agentHandle({ handle: `deployment-static-site-credentials-token-page-${row.providerId}` }, {
              role: "link",
              label: `Open ${row.label}'s own page for creating a personal access token`,
            })}
          >
            {translate("Create a token")}
          </a>
        </p>
      ) : null}
    </>
  );
}

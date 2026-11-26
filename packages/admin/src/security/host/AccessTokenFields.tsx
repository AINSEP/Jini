import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";
import { asciiSlug } from "../../shell/lib/ascii-slug.js";
import { SecretInput } from "../../shell/components/SecretInput/SecretInput.js";
import type { AdminPublishTargetField } from "../../deployment/api/deployment-api.types.js";
import { extraFieldsAroundToken, type AccessTokenProviderInfo } from "../access-token-providers.js";
import type { AccessTokensTabBindings } from "./AccessTokensTab.js";

/** Shared input markup for BOTH the "add a new token" form and an existing row's "replace" fields —
 *  same split `PublishCredentialFields`/`SourceControlCredentialFields` use for the identical
 *  connected/not-connected duality. Every hint renders below its input as `.field-hint`, never as
 *  placeholder text — same "placeholder-as-label reads as a saved value" defect this app has already
 *  fixed twice (`ProvidersTab.tsx`'s own header). */
export function TokenInputFields({ bindings,
  idPrefix,
  info,
  name,
  token,
  values,
  username,
  onNameChange,
  onTokenChange,
  onFieldChange,
  onUsernameChange,
  connected,
  t: translate,
}: { bindings: AccessTokensTabBindings;
  idPrefix: string;
  info: AccessTokenProviderInfo;
  name: string;
  token: string;
  values: Readonly<Record<string, string>>;
  username: string;
  onNameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onFieldChange: (name: string, value: string) => void;
  onUsernameChange: (value: string) => void;
  connected: boolean;
  t: Translate;
}) {

  // Only a custom row shows Username, always optional (`rules.ts`'s `AccessTokenProviderInfo` doc).
  const needsUsername = info.username !== undefined;
  const extraFields = extraFieldsAroundToken({ info });
  return (
    <div className="access-tokens-row-fields">
      <TokenNameField idPrefix={idPrefix} name={name} onNameChange={onNameChange} translate={translate} />
      <ExtraFieldInputs bindings={bindings} fields={extraFields.before} idPrefix={idPrefix} values={values} onFieldChange={onFieldChange} t={translate} />
      <TokenSecretField bindings={bindings} idPrefix={idPrefix} info={info} token={token} onTokenChange={onTokenChange} connected={connected} translate={translate} />
      <ExtraFieldInputs bindings={bindings} fields={extraFields.after} idPrefix={idPrefix} values={values} onFieldChange={onFieldChange} t={translate} />
      {needsUsername ? (
        <TokenUsernameField idPrefix={idPrefix} username={username} onUsernameChange={onUsernameChange} translate={translate} />
      ) : null}
    </div>
  );
}

/** A run of {@link ExtraFieldInput}s, in the order given. */
function ExtraFieldInputs({ bindings,
  fields,
  idPrefix,
  values,
  onFieldChange,
  t: translate,
}: { bindings: AccessTokensTabBindings;
  fields: readonly AdminPublishTargetField[];
  idPrefix: string;
  values: Readonly<Record<string, string>>;
  onFieldChange: (name: string, value: string) => void;
  t: Translate;
}) {
  const { fieldNameHandleSegment, accessTokenExtraFieldIdSuffix } = bindings.deps;

  return (
    <>
      {fields.map((field) => (
        <ExtraFieldInput bindings={bindings}
          key={field.name}
          id={`${idPrefix}-${accessTokenExtraFieldIdSuffix({ deps: { asciiSlug, fieldNameHandleSegment }, fieldName: field.name })}`}
          field={field}
          value={values[field.name] ?? ""}
          onChange={(value) => onFieldChange(field.name, value)}
          t={translate}
        />
      ))}
    </>
  );
}

/** One of a provider's descriptor fields (a host's account ID, bucket, region…): the descriptor's
 *  label (a host term, verbatim) plus the translated "(optional)" suffix, and its help below. */
function ExtraFieldInput({ bindings,
  id,
  field,
  value,
  onChange,
  t: translate,
}: { bindings: AccessTokensTabBindings;
  id: string;
  field: AdminPublishTargetField;
  value: string;
  onChange: (value: string) => void;
  t: Translate;
}) {
  const { fieldHelpText } = bindings.deps;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.required ? null : ` ${translate("(optional)")}`}
      </label>
      <SecretInput
        label={field.label}
        secret={field.secret === true}
        id={id}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...agentHandle({ handle: id }, { role: "field", label: `This provider's ${field.label}` })}
      />
      {fieldHelpText({ field }) ? <p className="field-hint">{fieldHelpText({ field })}</p> : null}
    </div>
  );
}

/** Reuse Jini's multiple-choice field, retaining disabled-plugin ids as removable raw chips.
 * Rendering costs O(options + selected) space and time; selection stays in the controller.
 */
export function WorksForField({ bindings, value = [], options = [], onChange, t }: { bindings: AccessTokensTabBindings;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (value: string[]) => void;
  t: Translate;
}) {
  const { OnboardingChipField } = bindings.kit;

  const choices = new Map(options.map(option => [option.value, option]));
  for (const id of value) if (!choices.has(id)) choices.set(id, { value: id, label: id });
  return <div className="field" role="group" aria-label={t("Works for")}>
    <OnboardingChipField multiple label={t("Works for")} options={[...choices.values()]} value={value} onChange={onChange} />
  </div>;
}

function TokenNameField({ idPrefix, name, onNameChange, translate }: Pick<Parameters<typeof TokenInputFields>[0], "idPrefix" | "name" | "onNameChange"> & { translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-name`}>
          {translate("Name")}
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          {...agentHandle({ handle: `${idPrefix}-name` }, { role: "field", label: "This token's display name" })}
        />
        <p className="field-hint">{translate("A short label so you can tell this token apart from others for the same provider.")}</p>
      </div>
  );
}

function TokenSecretField({ bindings, idPrefix, info, token, onTokenChange, connected, translate }: Pick<Parameters<typeof TokenInputFields>[0], "bindings" | "idPrefix" | "info" | "token" | "onTokenChange" | "connected"> & { translate: Translate }, _optional: Record<string, never> = {}) {

  const { storedTokenNotice } = bindings.deps;
  return (
<div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-token`}>
          {info.tokenLabel ?? translate("Access token")}
        </label>
        {/* `autoComplete="new-password"`, NOT `"off"` — Chrome deliberately ignores `off` on
            credential-shaped fields (a long-standing intentional decision, not a bug), and `off`
            here is what let the reported autofill through. `new-password` is the documented signal
            for "this field is not a saved-login field", which suppresses both the saved-credential
            dropdown and the silent fill.

            This input is why the SEARCH BOX at the top of the page was being filled with "admin":
            `TokenRow`'s `<details>` renders `ExistingTokenFields` unconditionally, so every saved
            token leaves a live password input in the DOM even while its row is collapsed. Chrome's
            formless credential heuristic groups a page's text-like fields with any password field
            by DOM proximity — no `<form>` required, and there is none in this feature — so the page
            read as a login surface and the first text-like field (the search box) got the site's
            saved username. Fixing the search box's own attribute could not work: the search box was
            the symptom, these fields are the trigger. */}
        <SecretInput
          label={info.tokenLabel ?? translate("Access token")}
          id={`${idPrefix}-token`}
          autoComplete="new-password"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          {...agentHandle({ handle: `${idPrefix}-token` }, { role: "field", label: "This token's secret value — stored encrypted, never shown again once saved" })}
        />
        <p className="field-hint">
          {connected ? translate("Leave blank to keep the current token.") : translate(storedTokenNotice)}
        </p>
        {info.scopeGuidanceKey !== "" || info.tokenPageUrl !== "" ? (
          <TokenScopeGuidance bindings={bindings} idPrefix={idPrefix} info={info} translate={translate} />
        ) : null}
      </div>
  );
}

function TokenScopeGuidance({ bindings, idPrefix, info, translate }: Pick<Parameters<typeof TokenInputFields>[0], "bindings" | "idPrefix" | "info"> & { translate: Translate }, _optional: Record<string, never> = {}) {
  const { DisclosureChevronIcon } = bindings.kit;
  return (
<details className="access-tokens-scope-guidance">
            <summary className="access-tokens-scope-guidance-summary">
              {translate("Which token do I need?")}
              <DisclosureChevronIcon size={10} />
            </summary>
            <p className="field-hint">
              {info.scopeGuidanceKey !== "" ? <>{translate(info.scopeGuidanceKey)} </> : null}
              {info.tokenPageUrl !== "" ? (
                <a
                  href={info.tokenPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  {...agentHandle({ handle: `${idPrefix}-token-page` }, { role: "link", label: `Open ${info.label}'s own page for creating a personal access token` })}
                >
                  {translate("Create a token")}
                </a>
              ) : null}
            </p>
          </details>
  );
}

function TokenUsernameField({ idPrefix, username, onUsernameChange, translate }: Pick<Parameters<typeof TokenInputFields>[0], "idPrefix" | "username" | "onUsernameChange"> & { translate: Translate }, _optional: Record<string, never> = {}) {
  return (
<div className="field">
          <label className="field-label" htmlFor={`${idPrefix}-username`}>
            {translate("Username")}
          </label>
          <input
            id={`${idPrefix}-username`}
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            {...agentHandle({ handle: `${idPrefix}-username` }, { role: "field", label: "The username this token authenticates against, when this provider needs one" })}
          />
          <p className="field-hint">{translate("Optional — only needed if this provider authenticates a token against a username.")}</p>
        </div>
  );
}

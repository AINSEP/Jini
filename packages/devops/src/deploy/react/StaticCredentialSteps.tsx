import type { ReactNode } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { formatTimestamp, interpolate, splitOnPlaceholders } from "@jini-ai/core/text";
import type { Translate } from "@jini-ai/core/text";
import type { AdminPublishExecutionMode } from "@jini-ai/core/contracts/site/api-security-api-types";
import type { PublishCredentialRowState, PublishCredentialsController } from "./hooks/use-publish-credentials.hooks.js";
import { credentialStepSubtitle, credentialVerifyStatusClass } from "./rules.js";
import { DisclosureChevron, StepDoneIcon } from "./deployment-visuals.js";
import type { StaticSiteTabProps } from "./StaticSiteTab.js";
import { PublishCredentialFields } from "./StaticCredentialFields.js";

/**
 * Step 1, not-yet-connected — open and prominent, no "Advanced" framing anywhere (the owner's own
 * redirect; see {@link PublishCredentialsSection}'s doc for the full story). Plain fields, not a
 * `<details>`: there is nothing to progressively disclose FROM here, since this IS the thing the
 * reader still has to do — hiding the one remaining blocking step behind a click would recreate the
 * exact problem this pass exists to fix.
 */
export function CredentialStepTodo({
  row,
  controller,
  executionMode,
  t: translate,
 deps, kit }: {
  row: PublishCredentialRowState;
  controller: PublishCredentialsController;
  executionMode: AdminPublishExecutionMode;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps" | "kit">, _optional = {}) {
  const { copy } = deps;
  return (
    <div
      className="deployment-step"
      {...agentHandle({ handle: `deployment-static-site-credentials-row-${row.providerId}` }, {
        role: "region",
        label: `${row.label}'s saved publish credential — not yet connected`,
      })}
    >
      <div className="deployment-step-head">
        <span className="deployment-step-marker" aria-hidden="true">
          1
        </span>
        <div className="deployment-step-headings">
          <h3 className="deployment-step-title">
            {translate("Connect")} <span translate="no">{row.label}</span>
          </h3>
          <p className="deployment-step-subtitle">{credentialStepSubtitle({ copy, executionMode, credential: row.credential, translate })}</p>
        </div>
      </div>
      <PublishCredentialFields kit={kit} deps={deps} row={row} controller={controller} t={translate} />
    </div>
  );
}

/**
 * Step 1, connected — collapsed to one settled summary line behind a native `<details>` (same
 * disclosure affordance this admin already uses elsewhere — `Jini redirects/react/pages/RedirectsPage.tsx`'s bulk-import panel,
 * `AiAssistant.tsx`'s roadmap accordion — rather than a second, JS-driven one), CLOSED by default:
 * the step is done, so it gets out of the way, the mirror image of {@link CredentialStepTodo}
 * staying open because its step is NOT done.
 *
 * The summary states the trust fact directly — "token stored, encrypted" — rather than leaving
 * "Connected" to imply it. The owner's own framing: a user pasting a real access token into this box
 * has to decide whether to believe it is actually being protected, and this admin can back the claim
 * — `publish_credential_sets` has no plaintext token column at all, only `sealed_ciphertext`/
 * `sealed_nonce`/`sealed_alg` (AES-GCM). This says only what is true and checkable from the UI's own
 * side of that boundary ("stored, encrypted"), not the specific cipher — the algorithm is an
 * implementation detail the interface has no business asserting and no way to keep honest if the
 * server ever changes it.
 *
 * Expanding the summary re-shows {@link PublishCredentialFields} to replace the token — the exact
 * fields {@link CredentialStepTodo} shows, just reached one click away rather than always open,
 * since changing an already-working credential is the rare path, not the common one.
 *
 * The summary row carries a visible "Replace token" label plus {@link DisclosureChevron} at its END
 * (owner-reported, 2026-08-15: the row was clickable but nothing on screen said so, and a reader with
 * a rotated token had no way to discover this row opens to a fresh token field). Placed at the end,
 * not the start: the step marker already occupies the start, and a second unstyled glyph there would
 * recreate the exact "which glyph means what" confusion the `::-webkit-details-marker` reset (see
 * `.deployment-step-summary` in `styles.css`) exists to avoid — a text label plus a chevron reads as
 * one clear affordance instead. `.deployment-step-summary-text` carries `flex: 1` so this action is
 * pushed to the row's far edge rather than trailing the timestamp mid-row.
 *
 * The timestamp reads "saved", never "updated": it is the moment this ROW was written, not a
 * liveness check — a revoked token still shows this same timestamp, and re-verifying (below) never
 * touches it. "updated" implied a recency the UI cannot back up from `saved` alone.
 *
 * ## Verify (2026-08-16 — closes a real gap, corrects this doc's own earlier "out of scope" call)
 *
 * An earlier pass of this doc said a verification indicator was "explicitly out of scope for this
 * row" — that held only until the assistant's own capability tool (`deployment_get_static_publish_
 * capabilities`) started telling a human to come HERE and "hit verify on the token" whenever its
 * cached verification went cold (e.g. a server restart — `InMemoryPublishCredentialVerificationCache`
 * has no persistence), and grepping this file for "verify" turned up nothing to click (see
 * the original verification-gap investigation for the full live-reproduction
 * chain). `POST .../credentials/:id/verify` (`publish-credentials.ts`) already existed and worked; the
 * gap was UI wiring only. {@link CredentialVerifyAction} closes it — a real re-check button living
 * inside `<summary>` itself (not the `<details>` content revealed on expand), because it has to stay
 * reachable while this row is collapsed, its normal resting state; see that component's own doc for
 * why a nested `<button>` there needs its click prevented from also toggling the details.
 *
 * A `"valid"` result carrying an `accountLabel` is durable — `usePublishCredentials`'s `verify` mirrors
 * the server's own `healAccountLabel` write onto `row.saved.accountLabel` immediately, which is what
 * lets the summary line below show "connected as X" even after a page reload, long after any single
 * verify RESPONSE (transient, session-only) is gone. That durability is the whole point: an operator
 * who verifies once should not have to re-verify again just to keep seeing which account this token
 * belongs to.
 */

/** One translated template with a single placeholder rendered as a React node (a name that must
 *  stay untranslated), so each locale places the name where its own grammar needs it. */
function TemplateWithNode({ template, token, children }: { template: string; token: string; children: ReactNode }, _optional = {}) {
  const [before, after] = splitOnPlaceholders({ template: template, tokens: [token] });
  return (
    <>
      {before}
      {children}
      {after}
    </>
  );
}

export function CredentialStepDone({
  row,
  controller,
  t: translate,
 kit, deps }: {
  row: PublishCredentialRowState;
  controller: PublishCredentialsController;
  t: Translate;
} & Pick<StaticSiteTabProps, "kit" | "deps">, _optional = {}) {
  const { Icon } = kit;
  const { LINE_ICON } = deps;
  const saved = row.saved;
  if (!saved) throw new Error(`publish credential row ${row.providerId} has no saved credential`);
  return (
    <details
      className="deployment-step deployment-step-done"
      {...agentHandle({ handle: `deployment-static-site-credentials-row-${row.providerId}` }, {
        role: "region",
        label: `${row.label}'s saved publish credential — connected`,
      })}
    >
      <summary className="deployment-step-summary">
        <span className="deployment-step-marker deployment-step-marker-done" aria-hidden="true">
          <StepDoneIcon lineIcon={LINE_ICON} Icon={Icon} />
        </span>
        <SavedCredentialSummary kit={kit} deps={deps} row={row} saved={saved} t={translate} />
        <CredentialVerifyAction row={row} controller={controller} t={translate} />
        <span className="deployment-step-summary-action">
          {translate("Replace token")}
          <DisclosureChevron lineIcon={LINE_ICON} Icon={Icon} />
        </span>
      </summary>
      <CredentialTokenPicker deps={deps} row={row} controller={controller} t={translate} />
      <PublishCredentialFields kit={kit} deps={deps} row={row} controller={controller} t={translate} />
    </details>
  );
}

/**
 * The "Verify" control on an already-connected row — re-checks the saved token against its real
 * provider right now (`PublishCredentialsController.verify`) and shows the outcome inline: the
 * provider's own message on success (a normal `"valid"`/`"invalid"`/`"unreachable"` result — see
 * `AdminPublishCredentialVerification.status`'s doc for why none of the three is treated as an
 * error), or a translated transport-failure message if the request itself never reached the server.
 *
 * Lives inside `<summary>`, a descendant of the native disclosure toggle, which means its click would
 * otherwise ALSO open/close the enclosing `<details>` (the browser runs `<summary>`'s toggle as the
 * click event's default action regardless of which descendant was actually clicked, unless that
 * default action is cancelled) — `preventDefault`/`stopPropagation` in the handler below is what
 * keeps a Verify click from also expanding the row every time.
 * @complexity O(1) — one button, one derived status line.
 */
function CredentialVerifyAction({
  row,
  controller,
  t: translate,
}: {
  row: PublishCredentialRowState;
  controller: PublishCredentialsController;
  t: Translate;
}, _optional = {}) {
  const statusText = row.verifyError ?? row.verification?.message ?? null;
  return (
    <span className="deployment-step-verify">
      <button
        type="button"
        className="btn-secondary"
        disabled={row.verifying}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void controller.verify(row.providerId);
        }}
        {...agentHandle({ handle: `deployment-static-site-credentials-verify-${row.providerId}` }, {
          role: "button",
          label: `Re-check the saved ${row.label} token against its real provider right now`,
        })}
      >
        {row.verifying ? translate("Verifying…") : translate("Verify")}
      </button>
      {statusText ? (
        <span aria-live="polite" className={credentialVerifyStatusClass({ row: row })}>
          {statusText}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The "which saved token publishes" picker (the owner's own original ask, per
 * `use-publish-credentials.hooks.ts`'s `credentialsForProvider` doc: "GitHub pages... will have a
 * dropdown where you can choose which GitHub access tokens"). Renders nothing when this provider has
 * at most one saved connection — the common case — since there is nothing to choose between; a lone
 * credential is already what {@link CredentialStepDone}'s summary line describes, and a picker with
 * one option would just repeat that fact as a control.
 *
 * Selecting an option promotes that credential to this provider's DEFAULT (`controller.selectCredential`),
 * the exact row a real publish uses (`defaultCredentialForProvider`'s own doc) — there is no separate
 * "which token does this publish use" setting anywhere else for this to drift from.
 * @complexity O(n) in this provider's own (small) saved-credential count, same bound
 *   {@link credentialsForProvider} documents.
 */
function CredentialTokenPicker({
  row,
  controller,
  t: translate,
 deps }: {
  row: PublishCredentialRowState;
  controller: PublishCredentialsController;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps">, _optional = {}) {
  const { copy, VIEWER_TIME_ZONE } = deps;
  // Rendered only inside the connected row (`row.saved` set — that row checks it too), so
  // the selected value falls back to the saved default's id with no further "nothing saved" arm.
  const options = controller.credentialsForProvider(row.providerId);
  if (options.length < 2) return null;
  const saved = row.saved;
  if (!saved) throw new Error(`publish credential picker ${row.providerId} has no saved credential`);
  const fieldId = `deployment-static-site-credentials-picker-${row.providerId}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId}>
        {translate("Which saved token publishes")}
      </label>
      <select
        id={fieldId}
        value={row.selectingCredentialId ?? saved.id}
        disabled={row.selectingCredentialId !== null}
        onChange={(e) => void controller.selectCredential({ providerId: row.providerId, credentialId: e.target.value })}
        {...agentHandle({ handle: fieldId }, {
          role: "field",
          label: `Choose which of this workspace's saved ${row.label} tokens is the one ${copy.productName} publishes with`,
        })}
      >
        {options.map((credential) => (
          <option key={credential.id} value={credential.id}>
            {(credential.accountLabel ?? credential.label) + " — " + formatTimestamp({ iso: credential.updatedAt }, { viewerTimeZone: VIEWER_TIME_ZONE })}
          </option>
        ))}
      </select>
      <p className="field-hint">
        {translate("This workspace has more than one saved")} <span translate="no">{row.label}</span>{" "}
        {translate(copy.pickerTokenNotice)}
      </p>
      <CredentialSelectionError row={row} />
    </div>
  );
}

function SavedCredentialSummary({ row, saved, t: translate , kit, deps }: { row: PublishCredentialRowState; saved: NonNullable<PublishCredentialRowState["saved"]>; t: Translate } & Pick<StaticSiteTabProps, "kit" | "deps">, _optional = {}) {
  const { CredentialHint } = kit;
  const { VIEWER_TIME_ZONE } = deps;
  return (
        <span className="deployment-step-summary-text">
          <TemplateWithNode template={translate("{host} connected")} token="{host}">
            <span translate="no">{row.label}</span>
          </TemplateWithNode>{" "}
          · {translate("token stored, encrypted")} ·{" "}
          {interpolate({ template: translate("saved {time}"), vars: { time: formatTimestamp({ iso: saved.updatedAt }, { viewerTimeZone: VIEWER_TIME_ZONE }) } })} <CredentialHint hint={saved.tokenHint} />
          {saved.accountLabel ? (
            <>
              {" "}
              ·{" "}
              <TemplateWithNode template={translate("connected as {account}")} token="{account}">
                <span translate="no">{saved.accountLabel}</span>
              </TemplateWithNode>
            </>
          ) : null}
        </span>
  );
}

function CredentialSelectionError({ row }: { row: PublishCredentialRowState }, _optional = {}) {
  return (
    <>
      {row.selectError ? (
        <p className="save-error" role="alert">
          {row.selectError}
        </p>
      ) : null}
    </>
  );
}

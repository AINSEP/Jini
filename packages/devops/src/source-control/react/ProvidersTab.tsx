import type { ComponentType, ChangeEvent } from "react";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import { agentHandle } from "@jini-ai/core/agent-handles";


import type { AdminSourceControlProviderId } from "./rules.js";
import type { fieldHelpText } from "../../deploy/react/rules.js";
import type { SourceControlProvidersNotice } from "./rules.js";
import { ConnectedMarkIcon, DisclosureChevronIcon } from "./source-control-visuals.js";
import type {
  SourceControlCredentialRowState,
  SourceControlCredentialsController,
} from "./hooks/use-source-control-credentials.hooks.js";

import { formatTimestamp, type Translate } from '@jini-ai/core/text';
/**
 * @file The Providers tab — `SourceControl.tsx`'s one tab today, and this feature's actual content.
 * Three always-visible rows — GitHub, GitLab, Bitbucket, in that order (GitHub is the one that
 * matters; the other two are real connectable rows, not "coming soon" stubs) — never a second-level
 * tab bar of their own. Moved here verbatim out of `SourceControl.tsx` in the 2026-08-16 page-shell
 * pass — see that file's own header for why the row content did not change, only what wraps it.
 *
 * ## No outer `.card` — owner-corrected the same pass
 *
 * The first cut of this file wrapped the row list in its own `.card` (icon + "Providers"
 * `card-title`) sitting under the `TabBar`. Owner's direct read: that is a card inside a card inside
 * a tab — each `.source-control-row` below is ALREADY its own bordered surface, so a second
 * bordered/background box around the whole list added a layer of chrome with no content of its own.
 * `features/pages/Pages.tsx` (a real `TabBar`-driven list screen) never wraps its rows in a card
 * either — `.card` there is reserved for an EMPTY state, not the populated list — so this tab now
 * matches that: the rows render directly under the tab, no enclosing card. `SourceControlIcon`
 * (`source-control-visuals.tsx`) lost its only call site here and is currently unused; left defined
 * rather than deleted in case a later pass finds it a home.
 *
 * ## Second density pass (2026-08-16) — an accordion, not three open forms
 *
 * The page-shell pass above shipped, the owner looked at it twice, and both times called it "a wall
 * of text" — the same complaint `deployment/StaticSiteTab.tsx`'s own "seventh pass" doc records for
 * the identical symptom (all four of ITS providers' full credential forms rendering at once). That
 * file's fix was a tab bar showing one provider's fields at a time; this page has no per-provider tab
 * bar by deliberate, still-standing decision (see the top of this file), so the equivalent fix here
 * is a native accordion: every row — connected or not — now renders behind `<details
 * name="source-control-provider">`. The shared `name` makes the three rows one EXCLUSIVE group
 * (Baseline since 2024 — Chrome 120, Safari 17.4, Firefox 129): opening one closes whichever other
 * row was open, no click handler or React state involved, so it stays presentation-layer.
 * {@link firstUnconnectedProviderId} decides which row starts open — the first one still needing a
 * token — so a first-time visitor already sees the one form they came to fill in, not three, and the
 * open row naturally advances to the next unconnected provider once the current one saves. This
 * supersedes {@link SourceControlRowTodo}'s old "always open, there is nothing to disclose FROM here"
 * reasoning (removed, not merely extended) — with three rows open at once that reasoning was exactly
 * what produced the wall the owner flagged twice.
 *
 * The per-row subtitle ("Save a personal access token so the host can use this account.") was identical
 * on all three rows and added nothing the heading plus the "Access token" field label didn't already
 * say — cut, along with its now-orphaned translation key across all 21 locale dictionaries. The
 * scope-guidance sentence stays exactly as owner-narrowed on 2026-08-15 (`rules.ts`'s own header) —
 * cutting ITS words was never the ask, only its default visibility — so it now sits behind its own
 * small nested "Which token do I need?" `<details>` inside {@link SourceControlCredentialFields},
 * reachable in one click rather than always-rendered.
 *
 * ## Two defects this page was briefed NOT to inherit
 *
 * 1. A connected/collapsed row needs a VISIBLE expand affordance — a text label plus a chevron —
 *    never a bare clickable row. See {@link SourceControlRowSummary}'s own doc.
 * 2. A saved-credential timestamp says "saved," never "updated" — "updated" falsely implies the
 *    token was recently re-verified, and a revoked token still shows that same timestamp. No
 *    token-liveness indicator is shown anywhere on this page either, for the same reason.
 *
 * This tab reuses `deployment/StaticSiteTab.tsx`'s `PublishCredentialFields` VISUAL pattern
 * deliberately (connected/not-connected split, same hint-below-input idiom) but owns no code
 * dependency on `features/deployment/` — two different agents were building the two features in the
 * same session, and this page's own icons (`source-control-visuals.tsx`), CSS
 * (`styles/source-control.css`), and hook plumbing are drawn fresh rather than imported
 * cross-feature.
 */

export interface ProvidersTabProps {
  useSourceControlCredentialsHook(): SourceControlCredentialsController;
  useAdminLocaleHook(): string;
  navigate(required: { routePath: string }): void;
  viewerTimeZone: string;
  CredentialHint: ComponentType<{ hint?: CredentialTokenHint | null }>;
  kit: { SecretInput: ComponentType<{ label: string; secret?: boolean; id: string; autoComplete: "new-password"; value: string; onChange(event: ChangeEvent<HTMLInputElement>): void }>; Icon: Parameters<typeof ConnectedMarkIcon>[0]["Icon"] };
  lineIcon: Parameters<typeof ConnectedMarkIcon>[0]["lineIcon"];
  fieldHelpText: typeof fieldHelpText;
  fieldNameHandleSegment(required: { fieldName: string }, optional?: Record<string, never>): string;
  copy: { providersRegionLabel: string; storedTokenHint: string };
}

export function ProvidersTab({
  useAdminLocaleHook,
  useSourceControlCredentialsHook, ...props }: ProvidersTabProps) {
  // Subscribes to the admin locale so a language switch re-renders this tab; every string itself
  // goes through the controller's own `t`.
  useAdminLocaleHook();

  const controller = useSourceControlCredentialsHook();

  return (
    <div
      className="source-control-tab form-measure"
      {...agentHandle({ handle: "source-control-providers" }, {
        role: "region",
        label: props.copy.providersRegionLabel,
      })}
    >
      <ProvidersNotice notice={controller.providersNotice} />
      <SourceControlCredentialsList controller={controller} t={controller.t} {...props} />
      <ManageAccessTokensLink t={controller.t} navigate={props.navigate} />
    </div>
  );
}

/**
 * Why a host is missing from the rows below, read-only (see `rules.ts`'s `sourceControlProvidersNotice`):
 * the sentence carries the next step, the list the server's own reasons naming each plugin.
 * @complexity O(r) in the reasons listed.
 */
function ProvidersNotice({ notice }: { notice: SourceControlProvidersNotice | null }) {
  if (notice === null) return null;
  return (
    <div className="notice" role="status"
      {...agentHandle({ handle: "source-control-providers-notice" }, { role: "status", label: "Why no source-control host is listed" })}
      aria-label="Why no source-control host is listed">
      <p>{notice.message}</p>
      {notice.reasons.length > 0 ? <ul>{notice.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
    </div>
  );
}

/**
 * Cross-link to the Access Tokens tab on the Security page — the same "ONE credential home" pattern
 * `deployment/StaticSiteTab.tsx`'s own `ManageAccessTokensLink` documents (2026-08-16 owner ruling,
 * `ADS-memory/reports/2026-08-17-source-control-ui.md`: "Security → Access Tokens is the ONE
 * credential home. Source Control keeps only real source hosts; Static Site picks a saved
 * credential."). The three rows above still handle the common case inline (one token per provider,
 * paste-and-save) — this is the escape hatch to what only Security's Access Tokens tab can do: save a
 * SECOND named token for GitHub/GitLab/Bitbucket, rename one, or manage every credential this install
 * holds (including the four publish providers) in one place.
 *
 * Deliberately NOT a 7-`VendorId` picker — a picker built from `VendorId` would list static
 * hosts and object stores as places to keep SOURCE CODE, which they are not; this page's own three rows
 * (the source-control hosts plugins declare, `rules.ts`'s `sourceControlProviders`) are the correct,
 * narrower provider set for what this page actually does.
 * @complexity O(1) — no branches.
 */
function ManageAccessTokensLink({ t: translate, navigate }: Pick<ProvidersTabProps, "navigate"> & { t: Translate }) {
  return (
    <p className="source-control-action-reason">
      {translate("Need to save more than one token, rename one, or manage every saved credential in one place?")}{" "}
      <button
        type="button"
        className="link-button"
        onClick={() => navigate({ routePath: "/access-tokens?tab=access-tokens" })}
        {...agentHandle({ handle: "source-control-manage-tokens-link" }, {
          role: "button",
          label: "Go to the Access Tokens tab on the Security page to create, rename, or manage saved tokens",
        })}
      >
        {translate("Create access token")}
      </button>
    </p>
  );
}

/** The host rows — loading/error states, then one row per listed host (and per saved connection's
 *  unlisted host). Split out of {@link ProvidersTab} purely for the complexity gate, same reasoning every
 *  other per-section split in this app documents: this repo's real `apps/admin` ESLint gate is a
 *  hard 9/9 cyclomatic/cognitive ceiling, and the loading/error branches plus the `.map()` counted
 *  directly in the tab component would have pushed it over budget alongside the header markup. */
function SourceControlCredentialsList({ controller, t: translate, ...props }: Pick<ProvidersTabProps, "viewerTimeZone" | "CredentialHint" | "kit" | "lineIcon" | "fieldHelpText" | "fieldNameHandleSegment" | "copy"> & { controller: SourceControlCredentialsController; t: Translate }) {
  if (controller.loadError) {
    return (
      <p
        className="notice error"
        role="status"
        {...agentHandle({ handle: "source-control-load-error" }, {
          role: "status",
          label: "Shows the error when saved source control connections could not be loaded",
        })}
      >
        {controller.loadError}
      </p>
    );
  }
  if (controller.rows === undefined) {
    return <p className="source-control-action-reason">{translate("Loading connections…")}</p>;
  }
  const defaultOpenProviderId = firstUnconnectedProviderId(controller.rows);
  return (
    <div className="source-control-rows">
      {controller.rows.map((row) => (
        <SourceControlProviderRow
          key={row.providerId}
          row={row}
          controller={controller}
          t={translate}
          defaultOpen={row.providerId === defaultOpenProviderId}
          {...props}
        />
      ))}
    </div>
  );
}

/** The first listed host still missing a saved connection, in row order —
 *  the one row {@link SourceControlProviderRow} defaults open. `undefined` once every provider is
 *  connected, matching every row starting collapsed (this file's own header explains why an
 *  accordion exists at all). Pure and React-free like this page's `rules.ts` helpers, but kept here
 *  rather than moved there: this decides a disclosure default, a presentation choice, not a fact
 *  about a credential — `rules.ts` stays the file with no opinion about what is open on screen.
 *  @complexity O(n) in the fixed, size-3 provider list. */
function firstUnconnectedProviderId(rows: readonly SourceControlCredentialRowState[]): AdminSourceControlProviderId | undefined {
  return rows.find((row) => row.saved === undefined && row.info.listed)?.providerId;
}

/**
 * One provider's row — a native `<details name="source-control-provider">`, connected or not, so
 * the three rows form one exclusive accordion group (this file's own header explains why). Replaces
 * the old {@link SourceControlRowTodo}/{@link SourceControlRowDone} split: both states now share this
 * one shell, differing only in the marker glyph and {@link SourceControlRowSummary}'s content —
 * mirrors `PublishCredentialsSection`'s single-row-at-a-time shape in `deployment/StaticSiteTab.tsx`,
 * built for the identical density complaint.
 *
 * `open={defaultOpen}` is intentionally uncontrolled: React sets it once per computed value and
 * otherwise leaves the DOM alone (it never re-asserts a prop that hasn't itself changed), so a
 * reader's own manual expand/collapse clicks survive re-renders of sibling rows — typing a token
 * into THIS row does not fight the accordion state of another.
 *
 * ## Seam for the not-yet-built "reuse the publish token" affordance
 *
 * 2026-08-16 owner decision: when a not-yet-connected row's provider already has a matching
 * Deployment publish credential saved (checked directly against the database this session — e.g.
 * `publish_credential_sets` already has a `github-pages` row for a workspace whose
 * `source_control_credential_sets` is empty), this row should offer a one-click "reuse that
 * credential" path instead of asking the operator to paste the same token twice. NOT built here —
 * it needs a server-side read across both credential stores plus a decrypt-and-reseal from one
 * sealed store into the other, both squarely outside this feature's fence (`lib/api.ts` wire types,
 * `src/**`). Dispatched separately.
 *
 * The affordance's insertion point, once that data exists: directly below {@link
 * SourceControlRowSummary}, ABOVE {@link SourceControlCredentialFields} — same "settled fact first,
 * fields second" order the connected summary already establishes, so a reader sees "a GitHub Pages
 * credential already exists" before being asked to type a new token into the fields underneath. It
 * needs to read, per provider, from the controller: whether a matching publish credential exists,
 * and when it was saved (same shape `AdminSourceControlCredentialSummary.updatedAt` already carries
 * for THIS store's own rows) — `SourceControlCredentialsController`/`useSourceControlCredentialsHook`
 * (`hooks/use-source-control-credentials.hooks.ts`) has neither field today; adding them is that
 * follow-up's job, not this pass's. No placeholder button renders here in the meantime — an inert
 * "Reuse token" control pointing at nothing would be a worse defect than the wait.
 */
function SourceControlProviderRow({
  row,
  controller,
  t: translate,
  defaultOpen,
  ...props
}: Pick<ProvidersTabProps, "viewerTimeZone" | "CredentialHint" | "kit" | "lineIcon" | "fieldHelpText" | "fieldNameHandleSegment" | "copy"> & {
  row: SourceControlCredentialRowState;
  controller: SourceControlCredentialsController;
  t: Translate;
  defaultOpen: boolean;
}) {
  const info = row.info;
  const connected = row.saved !== undefined;
  return (
    <details
      className={connected ? "source-control-row source-control-row-done" : "source-control-row"}
      open={defaultOpen}
      name="source-control-provider"
      {...agentHandle({ handle: `source-control-credentials-row-${row.providerId}` }, {
        role: "region",
        label: `${info.label}'s saved source control connection — ${connected ? "connected" : "not yet connected"}`,
      })}
    >
      <SourceControlRowSummary row={row} label={info.label} connected={connected} t={translate} viewerTimeZone={props.viewerTimeZone} CredentialHint={props.CredentialHint} kit={props.kit} lineIcon={props.lineIcon} />
      {/* An unlisted host (plugin off or missing) takes no new token; Access tokens can remove it. */}
      {info.listed ? (
        <SourceControlCredentialFields row={row} controller={controller} t={translate} kit={props.kit} lineIcon={props.lineIcon} fieldHelpText={props.fieldHelpText} fieldNameHandleSegment={props.fieldNameHandleSegment} copy={props.copy} />
      ) : (
        <p className="field-hint">{translate("Its plugin is off or missing. Remove this token on the Access tokens page.")}</p>
      )}
    </details>
  );
}

/**
 * A row's `<summary>` — split out of {@link SourceControlProviderRow} purely for this app's
 * complexity gate, same reasoning every other per-state split in this file documents.
 *
 * Not-connected: an empty ring marker plus a heading ("Connect GitHub") — the heading text is
 * already the call to action, so no separate subtitle repeats it (the old subtitle line, identical
 * on all three rows, was cut for exactly this reason — see this file's own header).
 *
 * Connected: the same summary line this page has always shown — a filled checkmark marker, the
 * settled trust fact ("token stored, encrypted"), and the SAVED time, never "updated" ("updated"
 * would falsely imply the token was recently re-verified, and a revoked token still carries whatever
 * timestamp is stored here regardless). No liveness/verification indicator is shown anywhere on this
 * row — this admin has no way to check a token is still valid without trying to use it, and claiming
 * otherwise would be exactly the kind of unbacked trust signal `CredentialStepDone`'s own doc in
 * `deployment/StaticSiteTab.tsx` warns against.
 *
 * Both states end in a trailing chevron — connected pairs it with visible "Replace token" text,
 * REQUIRED rather than a bare clickable row: a settled `<summary>` with its native disclosure
 * triangle stripped and no replacement was owner-reported as undiscoverable on the Static Site tab's
 * own credential rows (a reader with a rotated token had no way to tell the row could be reopened).
 * The not-connected chevron carries no extra label — its own heading text is already the action, so a
 * second "Add token" label next to it would repeat, not clarify.
 */
function SourceControlRowSummary({
  row,
  label,
  connected,
  t: translate,
  viewerTimeZone, CredentialHint, kit: { Icon }, lineIcon,
}: Pick<ProvidersTabProps, "viewerTimeZone" | "CredentialHint" | "kit" | "lineIcon"> & {
  row: SourceControlCredentialRowState;
  label: string;
  connected: boolean;
  t: Translate;
}) {
  const saved = row.saved;
  if (connected && !saved) throw new Error(`source control provider ${row.providerId} has no saved credential`);
  return (
    <summary className="source-control-row-summary">
      <span className={connected ? "source-control-row-marker source-control-row-marker-done" : "source-control-row-marker"} aria-hidden="true">
        {connected ? <ConnectedMarkIcon Icon={Icon} lineIcon={lineIcon} /> : null}
      </span>
      <span className="source-control-row-summary-text">
        {connected && saved ? (
          <>
            <span translate="no">{label}</span> {translate("connected")} · {translate("token stored, encrypted")} ·{" "}
            {translate("saved")} {formatTimestamp({ iso: saved.updatedAt }, { viewerTimeZone: viewerTimeZone })} <CredentialHint {...(saved.tokenHint === undefined ? {} : { hint: saved.tokenHint })} />
          </>
        ) : (
          <h3 className="source-control-row-title">
            {translate("Connect")} <span translate="no">{label}</span>
          </h3>
        )}
      </span>
      <span className="source-control-row-summary-expand">
        {connected ? translate("Replace token") : null}
        <DisclosureChevronIcon Icon={Icon} lineIcon={lineIcon} />
      </span>
    </summary>
  );
}

/** Optional token guidance stays hidden behind its disclosure until requested. */
function SourceControlScopeGuidance({ info, providerId, t, Icon, lineIcon }: { Icon: ProvidersTabProps["kit"]["Icon"]; lineIcon: ProvidersTabProps["lineIcon"]; info: SourceControlCredentialRowState["info"]; providerId: string; t: Translate }) {
  return <>
          {info.scopeGuidanceKey !== "" || info.tokenPageUrl !== "" ? (
            <details className="source-control-scope-guidance">
              <summary className="source-control-scope-guidance-summary">
                {t("Which token do I need?")}
                <DisclosureChevronIcon size={10} Icon={Icon} lineIcon={lineIcon} />
              </summary>
              <p className="field-hint">
                {info.scopeGuidanceKey !== "" ? <>{t(info.scopeGuidanceKey)} </> : null}
                {info.tokenPageUrl !== "" ? (
                  <a
                    href={info.tokenPageUrl}
                    target="_blank"
                    rel="noreferrer"
                    {...agentHandle({ handle: `source-control-credentials-token-page-${providerId}` }, {
                      role: "link",
                      label: `Open ${info.label}'s own page for creating a personal access token`,
                    })}
                  >
                    {t("Create a token")}
                  </a>
                ) : null}
              </p>
            </details>
          ) : null}
  </>;
}

/**
 * A row's fields — token input, the host's other declared fields, and the Save action. Shared between
 * both {@link SourceControlProviderRow} states, same split `PublishCredentialFields` uses in
 * `deployment/StaticSiteTab.tsx` and for the same reason: the fields and Save behavior are
 * identical in both states, only whether the reader has opened the row to see them differs.
 *
 * Every hint renders BELOW its input as `.field-hint`, never as placeholder text inside it — a
 * placeholder sitting in an empty box reads as a saved value at a glance, the exact confusion the
 * Static Site tab's own credential form was corrected out of. The inputs below
 * carry no `placeholder` prop at all, connected or not.
 *
 * The scope-guidance sentence (which token, which scopes) sits behind its own nested "Which token do
 * I need?" `<details>` rather than rendering by default — this file's own header records why: the
 * words themselves are the owner's own 2026-08-15 narrowing (`rules.ts`), untouched here, only their
 * default visibility changed. No `name` attribute on this inner `<details>` — it has nothing to stay
 * exclusive WITH, and giving it the outer accordion's own group name would fold it into that group by
 * mistake.
 */
function SourceControlCredentialFields({
  row,
  controller,
  t: translate,
  kit: { SecretInput, Icon }, lineIcon, fieldHelpText, fieldNameHandleSegment, copy,
}: Pick<ProvidersTabProps, "kit" | "lineIcon" | "fieldHelpText" | "fieldNameHandleSegment" | "copy"> & {
  row: SourceControlCredentialRowState;
  controller: SourceControlCredentialsController;
  t: Translate;
}) {
  const info = row.info;
  const connected = row.saved !== undefined;
  const tokenLabel = info.tokenLabel !== undefined ? translate(info.tokenLabel) : translate("Access token");

  return (
    <>
      <div className="source-control-credential-fields">
        <div className="field">
          <label className="field-label" htmlFor={`source-control-credentials-token-${row.providerId}`}>
            {tokenLabel}
          </label>
          <SecretInput
            label={tokenLabel}
            id={`source-control-credentials-token-${row.providerId}`}
            // `new-password`, not `off` — Chrome ignores `off` on credential-shaped fields by
            // design. See `security/AccessTokensTab.tsx`'s token input for the full reasoning.
            autoComplete="new-password"
            value={row.token}
            onChange={(e) => controller.setToken({ providerId: row.providerId, value: e.target.value })}
            {...agentHandle({ handle: `source-control-credentials-token-${row.providerId}` }, {
              role: "field",
              label: `${info.label} access token — stored encrypted, never shown again once saved`,
            })}
          />
          <p className="field-hint">
            {connected
              ? translate("Leave blank to keep the current token.")
              : translate(copy.storedTokenHint)}
          </p>
          <SourceControlScopeGuidance info={info} providerId={row.providerId} t={translate} Icon={Icon} lineIcon={lineIcon} />
        </div>

        {info.fields.map((field) => {
          const help = fieldHelpText({ field });
          return <div className="field" key={field.name}>
            <label className="field-label" htmlFor={`source-control-credentials-${fieldNameHandleSegment({ fieldName: field.name })}-${row.providerId}`}>
              {translate(field.label)}
            </label>
            <SecretInput
              label={translate(field.label)}
              secret={field.secret === true}
              id={`source-control-credentials-${fieldNameHandleSegment({ fieldName: field.name })}-${row.providerId}`}
              autoComplete="new-password"
              value={row.values[field.name] ?? ""}
              onChange={(e) => controller.setField({ providerId: row.providerId, name: field.name, value: e.target.value })}
              {...agentHandle({ handle: `source-control-credentials-${fieldNameHandleSegment({ fieldName: field.name })}-${row.providerId}` }, {
                role: "field",
                label: `${info.label} ${field.label}`,
              })}
            />
            {help !== undefined ? <p className="field-hint">{translate(help)}</p> : null}
          </div>;
        })}
      </div>

      <div className="source-control-action">
        <button
          type="button"
          disabled={!row.readyToSave || row.saving}
          onClick={() => void controller.save(row.providerId)}
          {...agentHandle({ handle: `source-control-credentials-save-${row.providerId}` }, {
            role: "button",
            label: `Save the ${info.label} access token`,
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

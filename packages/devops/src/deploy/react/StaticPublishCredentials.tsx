import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { PublishCredentialsController } from "./hooks/use-publish-credentials.hooks.js";
import type { StaticSiteTabProps } from "./StaticSiteTab.js";
import { CredentialStepTodo, CredentialStepDone } from "./StaticCredentialSteps.js";

/**
 * {@link PublishCredentialsSection}'s four state branches (load error, still loading, not-yet-
 * connected, connected), pulled into its own function so wrapping them in one shared region tag
 * doesn't add a branch to `PublishCredentialsSection` itself — same "extract rather than inline"
 * pattern `credentialStepSubtitle` (`rules.ts`) already uses in this file for the same complexity-gate
 * reason (`eslint.config.mjs`'s per-scope cap, `noInlineConfig` on so a disable comment cannot buy
 * the room back).
 */
function publishCredentialsSectionContent({
  controller,
  selectedProviderId,
  t: translate,
 deps, kit }: {
  controller: PublishCredentialsController;
  selectedProviderId: string;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps" | "kit">, _optional = {}) {
  if (controller.loadError) {
    return (
      <p
        className="notice error"
        role="status"
        {...agentHandle({ handle: "deployment-static-site-credentials-load-error" }, {
          role: "status",
          label: "Shows the error when saved publish credentials could not be loaded",
        })}
      >
        {controller.loadError}
      </p>
    );
  }

  if (controller.rows === undefined || controller.executionMode === undefined) {
    return <p className="deployment-action-reason">{translate("Loading credentials…")}</p>;
  }

  const row = controller.rows.find((r) => r.providerId === selectedProviderId);
  if (!row) return null;

  if (row.saved !== undefined) {
    return <CredentialStepDone kit={kit} deps={deps} row={row} controller={controller} t={translate} />;
  }
  return <CredentialStepTodo deps={deps} kit={kit} row={row} controller={controller} executionMode={controller.executionMode} t={translate} />;
}

/**
 * The credential step — Step 1 of the two-step flow this card walks a reader through (Step 2 is
 * {@link StaticPublishForm}'s "Where this publish goes"), for whichever provider is currently
 * selected on the tab bar above. Renders exactly one provider's state: {@link CredentialStepTodo}
 * when nothing is saved yet, {@link CredentialStepDone} once it is.
 *
 * Three passes got this section here. First, "'Add credential' should be gone. Just list the
 * providers, labels, and access token space, and that's it" (2026-08-15) replaced an add/edit/delete
 * flow with one always-visible row per provider. Then "it looks just awful" (2026-08-16) — all four
 * rows rendered at once regardless of the selected tab — collapsed it to the SELECTED provider's row
 * only. Then the owner's OWN direct read of that result: **"Advanced" is backwards for a mandatory
 * first step.** A new user cannot publish anything through this form until a token is saved here —
 * it is step one of two, not an optional extra — and the only reason it had ever been hidden behind
 * an "Advanced" disclosure was that four stacked forms were too ugly to leave visible. The collapse
 * removed that reason, so this pass removes the hiding along with it: disclosure now depends on
 * `row.saved` (has this actually been done), never on `controller.executionMode` (the OLD gate).
 * `executionMode` still matters — it changes WHY this step is mandatory, in
 * `credentialStepSubtitle` (`rules.ts`) — just not WHETHER it is shown open.
 *
 * The credential rows are the deploy registry's targets that take a credential, so
 * `selectedProviderId` matches exactly one row unless the selected host takes none; the `undefined`
 * fallback in {@link publishCredentialsSectionContent} covers that host.
 *
 * Renders only a brief "Loading…" line until BOTH `rows` and `executionMode` have resolved — showing
 * either step state for one render before the real data arrives would be a worse false impression
 * than a short, honest wait.
 *
 * Wraps whichever of the four states above is current in ONE `data-agent-element` region tag
 * (`deployment-static-site-credentials-section`), present in EVERY state rather than only some —
 * an agent-tagging assertion once covered this and quietly stopped matching anything the moment this
 * function grew four different top-level return shapes with no shared wrapper (caught 2026-08-15,
 * restored same day). This tag is not decorative: the coming repo picker (replacing the manual
 * `owner`/`repo` inputs) is meant to be driven by the assistant reading this page through
 * `data-agent-element`/`agentHandle()` tagging rather than a bespoke API, and a region that vanishes
 * in three states out of four is worse than no region at all — an agent reading the page cannot tell
 * "not on this page" from "not in this state". The wrapping `<div>` carries no class and no styles of
 * its own on purpose — it is a tag, not a layout primitive, and `.deployment-card-body`'s flex `gap`
 * (`styles.css`) already spaces this section correctly against its siblings regardless of what sits
 * one level inside it, so adding a box here would only be a second, redundant one around whichever
 * of {@link CredentialStepTodo}/{@link CredentialStepDone} already draws its own.
 */
export function PublishCredentialsSection(props: {
  controller: PublishCredentialsController;
  selectedProviderId: string;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps" | "kit">, _optional = {}) {
  return (
    <div
      {...agentHandle({ handle: "deployment-static-site-credentials-section" }, {
        role: "region",
        label: "The selected provider's saved publish credential — connect or replace flow",
      })}
    >
      {publishCredentialsSectionContent(props)}
    </div>
  );
}

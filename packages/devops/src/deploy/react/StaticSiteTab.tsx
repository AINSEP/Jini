import type { ChangeEvent, ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { StaticExportController } from "./hooks/use-static-export.hooks.js";
import type { StaticPublishController } from "./hooks/use-static-publish.hooks.js";
import type { PublishCredentialRowState, PublishCredentialsController } from "./hooks/use-publish-credentials.hooks.js";
import { credentialFieldHandleId } from "./rules.js";
import type { DeploymentCapability } from "./rules.js";
import { CapabilityList, StaticSiteIcon, StepDoneIcon } from "./deployment-visuals.js";
import { BuildExportCard } from "./StaticExportCard.js";
import { PublishCredentialsSection } from "./StaticPublishCredentials.js";
import { StaticPublishForm } from "./StaticPublishForm.js";

/**
 * @file Static Site tab — what a static export produces, a real trigger+poll build action, and a
 * real per-provider publish flow to GitHub Pages, Vercel, Netlify, or Cloudflare Pages.
 *
 * ## Third pass (2026-08-15) — the two "not wired up yet" halves both got wired
 *
 * The second pass's own header traced a grep (`runExportCommand|exportSite\b` against
 * `src/server/routes`) that returned nothing, and concluded the build button had to stay inert. That
 * grep is now stale for a second time, the same way it was corrected once already: a concurrent
 * agent landed `apps/website/src/server/inbound/admin-http/routes/system/export-site.ts` (`POST`/`GET .../system/export`,
 * trigger+poll, `system.export`-gated) the same session, registered in `apps/website/src/server/runtime/composition/app.ts`, tested in
 * `export-site-route.test.ts`. The build button below now calls it for real, through
 * `useWiredStaticExport` (`hooks/use-static-export.hooks.ts`).
 *
 * The publish half tells the same story a second time over: `apps/website/src/server/inbound/admin-http/routes/system/
 * publish-site.ts` (preview + trigger + poll, wrapping `features/deployments/static-publish/`) also
 * landed the same session, cookie-authed — a HUMAN clicking Publish in this admin, not the AI
 * assistant (`deployment_execute_static_publish`, the agent-tool half of this same feature, stays
 * declared-but-never-wired on purpose; see that tool's own doc comment in `publish-agent-tools.ts`
 * for why: no confirmation-token transport exists yet for an agent to trigger an irreversible public
 * publish). The "Getting it online" card below now has a real provider picker, preview, and publish
 * action wired through `useWiredStaticPublish` (`hooks/use-static-publish.hooks.ts`), sitting
 * alongside the CLI-first assistant route rather than replacing it — see that card's own doc for how
 * the two relate.
 *
 * The CLI-first assistant route (a `gh`/`vercel` PATH probe per provider) was removed 2026-09-29
 * (owner decision: publishing goes through the hosting plugins, not a server CLI).
 *
 * ## Fourth pass (2026-08-15) — the picker catches up to all four providers the credential form
 * already saved for
 *
 * The third pass wired a real picker, but `STATIC_PUBLISH_TARGETS` still only listed github-pages
 * and vercel even though `PUBLISH_CREDENTIAL_PROVIDERS` (below, in `rules.ts`) already covered all
 * four — a saved Netlify or Cloudflare Pages credential had no tab that could ever use it. Closed by
 * widening `STATIC_PUBLISH_TARGETS`/`AdminStaticPublishTargetId` to the full four-provider set the
 * server (`static-publish/adapter.ts`) already published to. Netlify and Cloudflare Pages have no
 * CLI this codebase drives, so their tab shows no CLI-first row at all (`StaticPublishTargetFields`'s
 * own doc) — the token-based credential form below is their only publish path today.
 *
 * ## Fifth pass (2026-08-15) — the credential section became a flat settings form, not a collection
 *
 * The fourth pass's credential block was still modelled as "manage a collection of named
 * connections": an "Add credential" button, a provider `<select>`, a user-invented `Label` field,
 * then a form. The owner's own read: "'Add credential' should be gone. Just list the providers,
 * labels, and access token space, and that's it" — plus a second complaint that the OLD edit-mode
 * form's placeholder text ("Leave blank to keep the current token") read as a prepopulated value at
 * a glance. `PublishCredentialsSection`/`PublishCredentialRow` below are the replacement: one
 * always-visible row per provider, no picker, no label, hints below every input rather than inside
 * it. See `use-publish-credentials.hooks.ts`'s own header for the hook-side half of this story.
 *
 * ## Sixth pass (2026-08-15) — a design pass on "it looks awful", with a fifth provider already on
 * the way
 *
 * Three fixes, none of them touching `use-static-publish.hooks.ts`/`use-static-export.hooks.ts`
 * (both off-limits this pass — their `busy`/`pollError` behaviour landed and was proven correct just
 * before this pass started; see `StaticPublishForm`'s own `busy` comment for the guard this pass
 * deliberately left alone):
 *
 * 1. "Publish directly from here" named nothing — a reader had no way to tell it apart from the
 *    credential above it. Renamed to "Where this publish goes", with a line contrasting it against
 *    the credential explicitly (`StaticPublishForm` below).
 * 2. `PublishCredentialRow`'s two-field layout (Cloudflare Pages only, today) broke under uneven
 *    field heights — see that component's own doc.
 * 3. Neither `StaticExportController.pollError` nor `StaticPublishController.pollError` was rendered
 *    ANYWHERE on this tab before this pass, despite both hooks having shipped it — a stalled poll
 *    silently re-enabled the button with no explanation on screen for why the spinner stopped.
 *    `BuildExportCard` and `StaticPublishForm` below now both render it, same `notice warning`
 *    treatment `PublishCredentialsSection`'s own hosted-mode notice already established on this tab.
 *
 * A fifth publish target (S3-compatible: AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces,
 * Wasabi, MinIO) is being spec'd separately and is NOT built here. It matters to this pass because it
 * will need roughly five credential fields (endpoint, access key id, secret access key, bucket,
 * region) with uneven hint lengths of its own — exactly the shape `PublishCredentialRow`'s single-
 * column fix (fix 2 above) exists to tolerate, and exactly why that fix did not just special-case
 * Cloudflare Pages' two fields.
 *
 * ## Seventh pass (2026-08-16) — the sixth pass polished the boxes; the owner's actual complaint was
 * that there were sixteen fields of them on screen at once
 *
 * The sixth pass ("Publish directly from here" -> "Where this publish goes", the two-field-row fix,
 * surfacing `pollError`) shipped, the owner looked at the running app, and the verdict was "it looks
 * just awful" — followed by the real diagnosis: `PublishCredentialsSection` rendered ALL FOUR
 * providers' credential forms simultaneously, regardless of which tab was selected. A reader on the
 * GitHub Pages tab saw GitHub Pages' fields, then Vercel's, then Netlify's, then Cloudflare Pages',
 * all inside one `<details>` — a wall of "ACCESS TOKEN" boxes nobody but that one reader's own
 * provider needed. Three changes, all in this file plus `TabBar.tsx`/`styles.css`:
 *
 * 1. **The credential section now renders exactly one row: the SELECTED provider's.** See
 *    `PublishCredentialsSection`'s own doc for the filter and why the id-set guarantee between
 *    `STATIC_PUBLISH_TARGETS` and `PUBLISH_CREDENTIAL_PROVIDERS` makes it safe. This is the fix the
 *    owner explicitly approved — collapsing a 4-row wall down to whichever one the reader is already
 *    looking at.
 * 2. **The connected/not-connected fact the old all-rows layout gave away for free moved onto the tab
 *    bar itself.** Collapsing to one row would otherwise have made it strictly WORSE than before —
 *    "which providers have I already connected" was visible pre-collapse (scroll down, look at four
 *    pills) and invisible post-collapse (click through every tab to find out) unless it went
 *    somewhere else. `TabBar.tsx`'s new `TabBarTab.dot`/`dotLabel` puts a small filled dot on any tab
 *    whose provider has a saved credential (`connectedProviderIds`, computed once from
 *    `credentialsController.rows` below) — visible from EVERY tab at once, which the old layout never
 *    actually managed either (you had to scroll to a row to see ITS OWN status, never all four at a
 *    glance without scrolling). Generic and opt-in on `TabBar.tsx` itself, so `Themes.tsx`/`Pages.tsx`
 *    (its other two callers) render unchanged — see that prop's own doc for the accessibility
 *    reasoning (presence, not color alone, carries the meaning).
 * 3. **Visual weight now matches actual importance.** Before this pass, `.deployment-route`'s tinted-
 *    surface-plus-`--primary`-left-border treatment was applied identically to three different-weight
 *    blocks: the CLI recommendation (a suggestion), the "no CLI path" note (a fact), and "Where this
 *    publish goes" (the actual Preview/Publish action — this tab's real job). Nothing stood out as
 *    more important than anything else. The CLI recommendation and the "no CLI path" note now use
 *    `.deployment-route-quiet` (`styles.css`) — same structure, no strong accent — so the one block
 *    that ends in a live "publish this to the public internet" action is the one block on this card
 *    that still looks like it. The credential row's own box also lost its NESTED border/background
 *    inside the Advanced `<details>`/hosted-mode `.deployment-route` it now sits alone in — a single
 *    row no longer needs to look like a card inside a card inside a disclosure.
 *
 * None of this touches `use-static-publish.hooks.ts`/`use-static-export.hooks.ts`, or the `busy`
 * guard `StaticPublishForm`'s own comment documents — both were verified correct earlier the same
 * day and stayed off-limits this pass too.
 */

export interface StaticSiteTabProps {
  /** DI seams for tests — same convention as every other wired-hook prop in this app
   *  (`DockerfileTabProps.useDockerfileSourceHook`, `OverviewTabProps.useDeploymentOverviewHook`). */
  hooks: {
    useStaticExportHook: () => StaticExportController;
    useStaticPublishHook: () => StaticPublishController;
    usePublishCredentialsHook: (required: { targets: StaticPublishController["targets"] }) => PublishCredentialsController;
    useAdminLocale: () => string;
    useWiredCopyToClipboard: () => { copied: boolean; copy: (text: string) => Promise<boolean> };
  };
  kit: {
    Icon: Parameters<typeof StepDoneIcon>[0]["Icon"];
    CredentialHint: ComponentType<{ hint?: NonNullable<PublishCredentialRowState["saved"]>["tokenHint"] | null }>;
    SecretInput: ComponentType<{ label: string; secret: boolean; id: string; autoComplete: "new-password"; value: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void }>;
    TabBar: ComponentType<{ ariaLabel: string; tabs: readonly { id: string; label: string; dot: boolean; dotLabel: string }[]; activeId: string; onChange: (id: string) => void }>;
    ErrorNotice: ComponentType<{ failure: NonNullable<StaticPublishController["publishFailure"]>; t: Translate; className: string }>;
  };
  deps: {
    PUBLISH_RUN_RESULT_CLASSES: { readonly success: string; readonly error: string };
    LINE_ICON: Parameters<typeof StepDoneIcon>[0]["lineIcon"];
    copy: {
      credentialSubtitle: string;
      exportDescription: string;
      exportCommand: string;
      storedTokenNotice: string;
      pickerTokenNotice: string;
      productName: string;
    };
    asciiSlug: Parameters<typeof credentialFieldHandleId>[0]["asciiSlug"];
    STATIC_SITE_CAPABILITIES: readonly DeploymentCapability[];
    createStaticSiteTabTranslator: (required: { locale: string }) => Translate;
    adminHref: (required: { routePath: string }) => string;
    navigate: (required: { routePath: string }) => void;
    t: (required: { locale: string; key: string }) => string;
    VIEWER_TIME_ZONE: string;
    pluginsPath: string;
    accessTokensPath: string;
  };
}

export function StaticSiteTab(props: StaticSiteTabProps, _optional = {}) {
  const { deps, kit } = props;
  const { createStaticSiteTabTranslator } = deps;
  const { hooks } = props;
  const locale = hooks.useAdminLocale();
  const translate = createStaticSiteTabTranslator({ locale });

  // Keep the DI seams. Forwarding resolvers previously isolated these branches for the
  // complexity gate; this component is small enough to resolve its defaults directly.

  const exportController = hooks.useStaticExportHook();
  const publishController = hooks.useStaticPublishHook();
  const credentialsController = hooks.usePublishCredentialsHook({ targets: publishController.targets });

  return (
    <div className="deployment-tab">
      <StaticExportCapabilities deps={deps} locale={locale} translate={translate} publishController={publishController} />

      <BuildExportCard deps={deps} hooks={hooks} controller={exportController} t={exportController.t} />

      <GettingItOnlineCard deps={deps} kit={kit}
        publishController={publishController}
        credentialsController={credentialsController}
        t={publishController.t}
      />
    </div>
  );
}

function StaticExportCapabilities({ locale, translate, publishController , deps }: { locale: string; translate: Translate; publishController: StaticPublishController } & Pick<StaticSiteTabProps, "deps">, _optional = {}) {
  const { LINE_ICON, t } = deps;
  return (
      <div className="card">
        <div className="card-head">
          <div className="deployment-path-head">
            <span className="deployment-path-icon">
              <StaticSiteIcon lineIcon={LINE_ICON} />
            </span>
            <h2 className="card-title">{t({ locale: locale, key: "What a static export gives you" })}</h2>
          </div>
          <div className="card-head-actions">
            <span className="status status-neutral">{t({ locale: locale, key: "Available here" })}</span>
          </div>
        </div>
        <div className="deployment-card-body">
          <p className="card-lead">
            {t({ locale: locale, key: "A fast, read-only copy of this site's published pages — no server behind it." })}
          </p>
          <StaticExportCapabilityDetails deps={deps} locale={locale} translate={translate} publishController={publishController} />
        </div>
      </div>
  );
}

function StaticExportCapabilityDetails({ locale, translate, publishController , deps }: { locale: string; translate: Translate; publishController: StaticPublishController } & Pick<StaticSiteTabProps, "deps">, _optional = {}) {
  const { LINE_ICON, STATIC_SITE_CAPABILITIES, t } = deps;
  return (
          <div className="deployment-split">
            <div>
              <span className="deployment-fact-label">{t({ locale: locale, key: "What survives the export" })}</span>
              <CapabilityList lineIcon={LINE_ICON} rows={STATIC_SITE_CAPABILITIES} t={translate} />
            </div>
            <div>
              <span className="deployment-fact-label">{t({ locale: locale, key: "Where it runs" })}</span>
              <ul className="deployment-chips">
                {(publishController.targets ?? []).map((target) => (
                  <li key={target.id} translate="no">
                    {target.label}
                  </li>
                ))}
              </ul>
              <p className="deployment-action-reason">
                {t({ locale: locale, key: "The output is a plain folder of files — any static host will serve it." })}
              </p>
            </div>
          </div>
  );
}

/** The "Getting it online" card — a provider picker and that provider's own credential step and
 *  preview+publish mini-form. Composed as its own function (not inline in `StaticSiteTab`) for the
 *  same complexity-gate reason `Deployment.tsx`'s `deploymentTabPanel` documents.
 *
 *  `t` is `publishController.t` (the injected hook's own bound translator), not a second one built
 *  from `useAdminLocale()` — same "the DI seam has to actually be exercised" reasoning
 *  `use-deployment-overview.unit.test.tsx`'s own "proving the value isn't built internally" test
 *  pins for `OverviewTab`. One card, one translator, so a test injecting a fake `useStaticPublishHook` controls every string
 *  this card renders. */
function GettingItOnlineCard({
  publishController,
  credentialsController,
  t: translate,
 deps, kit }: {
  publishController: StaticPublishController;
  credentialsController: PublishCredentialsController;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps" | "kit">, _optional = {}) {
  const { adminHref, pluginsPath } = deps;
  if (publishController.targets?.length === 0 && !publishController.targetsError) {
    return <div className="empty-state">
      <p>{translate("Enable a hosting plugin to publish this site.")}</p>
      <a href={adminHref({ routePath: pluginsPath })}>{translate("Plugins")}</a>
    </div>;
  }
  const selectedTargetId = publishController.target;

  // One `Set` lookup per render, not a `.find()` inside the `.map()` below — keeps the connected
  // check a single small expression the `tabs` map stays readable with. `undefined` (rows not
  // loaded yet) reads as "nothing connected yet" rather than a loading state of its own.
  const connectedProviderIds = new Set((credentialsController.rows ?? []).filter((row) => row.saved !== undefined).map((row) => row.providerId));

  return (
    <div
      className="card"
      {...agentHandle({ handle: "deployment-static-site-online-card" }, {
        role: "region",
        label: "Publish target picker and direct preview/publish form for this static export",
      })}
    >
      <div className="card-head">
        <h2 className="card-title">{translate("Getting it online")}</h2>
      </div>
      <GettingItOnlineContent kit={kit} deps={deps} publishController={publishController} credentialsController={credentialsController} selectedTargetId={selectedTargetId} connectedProviderIds={connectedProviderIds} t={translate} />
    </div>
  );
}

function GettingItOnlineContent({ publishController, credentialsController, selectedTargetId, connectedProviderIds, t: translate , kit, deps }: { publishController: StaticPublishController; credentialsController: PublishCredentialsController; selectedTargetId: string; connectedProviderIds: ReadonlySet<string>; t: Translate } & Pick<StaticSiteTabProps, "kit" | "deps">, _optional = {}) {
  const { TabBar } = kit;
  return (
      <div className="deployment-card-body">
        <PublishTargetLoadNotice publishController={publishController} />
        {publishController.targetsError ? (
          <p className="notice error" role="status">
            {publishController.targetsError}
          </p>
        ) : null}
        <p className="card-lead">
          {translate(
            "The export is just a folder of files. Pick where it goes, then publish straight from here."
          )}
        </p>

        <TabBar
          ariaLabel={translate("Publish target")}
          tabs={(publishController.targets ?? []).map((target) => ({
            id: target.id,
            label: target.label,
            dot: connectedProviderIds.has(target.id),
            dotLabel: translate("Connected"),
          }))}
          activeId={selectedTargetId}
          onChange={publishController.setTarget}
        />

        <PublishCredentialsSection deps={deps} kit={kit} controller={credentialsController} selectedProviderId={selectedTargetId} t={translate} />
        <ManageAccessTokensLink deps={deps} t={translate} />

        <StaticPublishForm deps={deps} kit={kit}
          controller={publishController}
          credentialChangePending={credentialsController.credentialChangePending}
          chosenCredentialId={chosenCredentialIdForTarget(credentialsController, selectedTargetId)}
          t={translate}
        />
      </div>
  );
}

function PublishTargetLoadNotice({ publishController }: { publishController: StaticPublishController }, _optional = {}) {
  return (
    <>
        {publishController.loadError ? (
          <p
            className="notice error"
            role="status"
            {...agentHandle({ handle: "deployment-static-site-publish-load-error" }, {
              role: "status",
              label: "Shows the error when this publish's current status could not be loaded",
            })}
          >
            {publishController.loadError}
          </p>
        ) : null}
    </>
  );
}

/**
 * Cross-link from this tab's single-token-per-provider credential row to the fuller Access Tokens
 * tab on the Security page — the owner's own ask, verbatim: "a button 'create access token' that
 * takes them back to the access token tab on the security page." This tab's own row above still
 * handles the common case inline (one token per provider, paste-and-save) — {@link
 * PublishCredentialsSection} is deliberately UNCHANGED by this link, per the standing "Static Site
 * stays as-is for now" decision (`ADS-memory/reports/2026-08-17-source-control-ui.md`). This is the
 * escape hatch to what Security's Access Tokens tab can do that this row cannot: save a SECOND named
 * token for the same provider, rename one, or remove one — `AccessTokensTab.tsx`'s own header on
 * why "Create" living there too is not a duplicate of what this tab does.
 *
 * One link per card, not one per provider — clicking it always lands on the same destination
 * regardless of which of the four tabs is currently selected, so it renders once beneath the
 * credential section rather than being threaded through {@link PublishCredentialFields} four times.
 * Plain `navigate()`, not `{ replace: true }` — this is a real navigation to a different page (the
 * reader may want the Back button to return here), unlike this tab's own `handleTabChange`-style
 * calls, which only swap a `?tab=` query param on the SAME page.
 * @complexity O(1) — no branches.
 */
function ManageAccessTokensLink({ t: translate , deps }: { t: Translate } & Pick<StaticSiteTabProps, "deps">, _optional = {}) {
  const { navigate, accessTokensPath } = deps;
  return (
    <p className="deployment-action-reason">
      {translate("Need to save more than one token, rename one, or manage every saved credential in one place?")}{" "}
      <button
        type="button"
        className="link-button"
        onClick={() => navigate({ routePath: accessTokensPath })}
        {...agentHandle({ handle: "deployment-static-site-manage-tokens-link" }, {
          role: "button",
          label: "Go to the Access Tokens tab on the Security page to create, rename, or manage saved tokens",
        })}
      >
        {translate("Create access token")}
      </button>
    </p>
  );
}

/** The token-based preview+publish mini-form for whichever target is currently selected. Reads
 *  ONLY the fields the current target uses (see `use-static-publish.hooks.ts`'s header for why the
 *  hook still keeps all five target fields in state at once) — a target never shows another
 *  target's companion field (e.g. an owner/repo pair vs a `teamId`); a target with neither shows neither. */
/** The saved connection this provider's row is currently showing as the one that publishes — the
 *  id the Publish request must NAME, so the server publishes with that account instead of resolving
 *  whichever row is default when the POST lands (terra review 2026-09-20, finding 1). `undefined`
 *  when this provider has no saved connection: an install publishing from server env vars has no
 *  connection ids at all, and that caller keeps the server's default lookup.
 *
 *  Reads `saved` and not `selectingCredentialId`: a pick still in flight is not yet the connection
 *  that publishes, and Publish is disabled for that whole window anyway
 *  ({@link PublishCredentialsController.credentialChangePending}).
 *
 *  @complexity O(providers) — a four-element scan. */
function chosenCredentialIdForTarget(controller: PublishCredentialsController, target: string): string | undefined {
  return controller.rows?.find((row) => row.providerId === target)?.saved?.id;
}

export function bindStaticSiteTab(required: StaticSiteTabProps, _optional = {}) {
  return function BoundStaticSiteTab(_required: Record<string, never>, _optional = {}) {
    return <StaticSiteTab {...required} />;
  };
}

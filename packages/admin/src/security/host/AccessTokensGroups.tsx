import type { useMergedSecretsOrder } from "./AccessTokensTab.hooks.js";
import { useRef } from "react";
import { agentHandle, agentHandleSegment } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";
import type { AccessTokenCategoryId } from "../access-token-categories.js";
import type { AccessTokenProviderRef } from "../access-token-rows.js";
import { providerGroupSubtitleKeys } from "../access-token-providers.js";
import type { AccessTokenProviderGroupState, AccessTokensController } from "./hooks/use-access-tokens.hooks.js";
import type { OtherCredentialsController } from "./hooks/use-other-credentials.hooks.js";
import type { AccessTokensTabBindings } from "./AccessTokensTab.js";
import { TokenRow, AddTokenForm } from "./AccessTokenRows.js";
import { AddCustomCredentialDialog } from "./AccessTokenDialogs.js";

/** A provider group can take another saved token unless it is custom or unlisted. */
function acceptsAnotherToken(info: { kind: string; unlisted?: boolean }): boolean {
  return info.kind !== "custom" && !info.unlisted;
}

/** Loading/error/populated split — pulled out of {@link AccessTokensTab} purely for the complexity
 *  gate, same reasoning `SourceControlCredentialsList` documents in `ProvidersTab.tsx`. Waits for
 *  BOTH tiers' first load: rendering Tier 1's list before Tier 2 has resolved would put the category
 *  filter and the row list on screen a beat before Tier 2's own rows could ever appear under it,
 *  which reads as those rows being silently absent rather than still loading.
 *
 * `useMergedSecretsOrder` (a hook) is called unconditionally, ahead of every early return below —
 * Rules of Hooks — even though its result is only rendered once the loading/error gates pass; it
 * tolerates either controller's `groups` still being `undefined` internally (`AccessTokensTab.hooks.tsx`'s
 * own doc), so calling it early costs nothing. */
export function AccessTokensBody({ bindings, controller, otherController,
 }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; otherController: OtherCredentialsController;
 }) {

  const { useMergedSecretsOrderHook } = bindings.hooks;

  const addCustomDialogRef = useRef<HTMLDialogElement>(null);
  const merged = useMergedSecretsOrderHook({ controller, otherController, query: controller.query, deps: bindings.deps });
  return (
    <>
      <StoreNotices controller={controller} otherController={otherController} />
      {controller.groups === undefined || otherController.groups === undefined
        ? <p className="access-tokens-loading">{controller.t("Loading access tokens…")}</p>
        : <AccessTokensLoaded bindings={bindings} controller={controller} otherController={otherController} addCustomDialogRef={addCustomDialogRef} merged={merged} />}
    </>
  );
}

function StoreNotices({ controller, otherController }: { controller: AccessTokensController; otherController: OtherCredentialsController }, _optional: Record<string, never> = {}) {
  return <>
    {controller.loadError ? (
      <p className="notice error" role="status" {...agentHandle({ handle: "security-access-tokens-load-error" }, { role: "status", label: "Shows the error when saved access tokens could not be loaded" })}>
        {controller.loadError}
      </p>
    ) : null}
    {otherController.loadError ? (
      <p className="notice error" role="status" {...agentHandle({ handle: "security-other-credentials-load-error" }, { role: "status", label: "Shows the error when other saved credentials could not be loaded" })}>
        {otherController.loadError}
      </p>
    ) : null}
  </>;
}

/** The hosting filter can be empty while source-control groups still exist. */
function HostingPluginsHint({ bindings, controller }: { bindings: AccessTokensTabBindings; controller: AccessTokensController }) {
  const { hostingPluginsHref } = bindings.deps;

  if (controller.query || !["all", "hosting"].includes(controller.category) || controller.groups?.some((group) => group.info.category === "hosting")) return null;
  return <div className="empty-state">
    <p>{controller.t("Enable a hosting plugin to manage its access tokens.")}</p>
    <a href={hostingPluginsHref}>{controller.t("Plugins")}</a>
  </div>;
}

/** The `All / Source control / Hosting / Media / AI / Ops` filter row, PLUS the "Add custom
 *  provider" button — see this file's header for why the filter row borrows Settings' wrapped
 *  icon-tab-row LOOK rather than the component itself. The button is a deliberately SEPARATE
 *  control after the mapped category pills (`margin-left: auto` in `access-tokens.css` pushes it to
 *  the far right of the row), not a pill itself — it opens a create form, it does not filter
 *  anything, so it must never read as an eighth category to a search/scan of this row. Pulled out
 *  of {@link AccessTokensBody} for the complexity gate; its own branching is a single `.map()` plus
 *  one static button, so this split is about readability/reuse rather than a budget this one
 *  function would otherwise exceed. */
function AccessTokensCategoryFilter({ bindings, controller, onAddCustomProvider,
 }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; onAddCustomProvider: () => void;
 }) {
  const { useTabBarKeyboardHook } = bindings.hooks;
  const { ACCESS_TOKEN_CATEGORIES } = bindings.deps;

  const translate = controller.t;
  // Reuses `TabBar.hooks.tsx`'s WAI-ARIA tabs keyboard helpers rather than reimplementing them —
  // `ACCESS_TOKEN_CATEGORIES`'s `{ id, label }` shape structurally satisfies `TabBarTab`, and none
  // of these categories are ever disabled. `[role="tab"]` scoping already skips the non-tab
  // "+ Add custom provider" button below (this file's own header on why that button stays out of
  // the tablist's tab order).
  const { onKeyDown } = useTabBarKeyboardHook({ tabs: ACCESS_TOKEN_CATEGORIES, activeId: controller.category, onChange: (id) => controller.setCategory(id as AccessTokenCategoryId) });
  return (
    <div
      className="access-tokens-category-filter"
      role="tablist"
      aria-label={translate("Filter by category")}
      onKeyDown={onKeyDown}
      {...agentHandle({ handle: "security-access-tokens-category-filter" }, { role: "region", label: "Filter the credential list by category" })}
    >
      <AccessTokensCategoryItems bindings={bindings} controller={controller} translate={translate} />
      <button
        type="button"
        className="access-tokens-add-custom-button"
        onClick={onAddCustomProvider}
        {...agentHandle({ handle: "security-access-tokens-add-custom-provider" }, { role: "button", label: "Add a custom provider not in the built-in list" })}
      >
        {translate("+ Add custom provider")}
      </button>
    </div>
  );
}

/** The search box and its own match-count line — counts are the SUM of both tiers'
 *  `totalCount`/`matchCount` (this file's header on why the combined count stays a GLOBAL fact,
 *  unaffected by the category filter below it). "token(s)" stays the noun even though the count now
 *  spans Tier 2's keys/credentials too — the original e2e suite pins the exact string
 *  (the access-token e2e check's `/^0 tokens saved$/`), and nothing in this pass asked
 *  for new copy here; a person calling an API key a "token" loosely is the same shorthand this
 *  page's own tab name already uses for the whole install. The line itself is `rules.ts`'s
 *  `accessTokensCountText` — a whole translated sentence per plural form, not fragments glued in
 *  English word order (see that function's own doc for why). */
function AccessTokensSearch({ bindings, controller, otherController }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; otherController: OtherCredentialsController }) {
  const { SearchIcon } = bindings.kit;
  const { accessTokensCountText } = bindings.deps;

  const translate = controller.t;
  const totalCount = controller.totalCount + otherController.totalCount;
  const matchCount = controller.matchCount + otherController.matchCount;
  const countText = accessTokensCountText({ totalCount, matchCount, query: controller.query }, { t: translate });
  return (
    <div className="access-tokens-search">
      <label className="visually-hidden" htmlFor="access-tokens-search">
        {translate("Search access tokens")}
      </label>
      <span className="access-tokens-search-icon">
        <SearchIcon />
      </span>
      <input
        id="access-tokens-search"
        className="access-tokens-search-input"
        type="search"
        autoComplete="off"
        value={controller.query}
        onChange={(e) => controller.setQuery(e.target.value)}
        placeholder={translate("Search by provider, name, or purpose")}
        {...agentHandle({ handle: "security-access-tokens-search" }, { role: "field", label: "Search saved access tokens by provider, name, or purpose" })}
      />
      <p className="access-tokens-search-count" role="status" aria-live="polite">
        {countText}
      </p>
    </div>
  );
}

function ProviderGroup({ bindings, group, controller }: { bindings: AccessTokensTabBindings; group: AccessTokenProviderGroupState; controller: AccessTokensController }) {
  const { ACCESS_TOKEN_PROVIDER_COPY, providerGroupHandleLabel } = bindings.deps;

  const ref: AccessTokenProviderRef = { kind: group.info.kind, providerId: group.info.providerId };
  const hasRows = group.rows.length > 0;
  return (
    <section
      className="access-tokens-provider-group"
      {...agentHandle({ handle: `security-access-tokens-group-${group.info.kind}-${agentHandleSegment({ value: group.info.providerId })}` }, {
        role: "region",
        label: providerGroupHandleLabel({ info: group.info, connectedCount: group.rows.length }),
      })}
    >
      <h3 className="access-tokens-provider-heading">
        <span translate="no">{group.info.label}</span>
        <span className="access-tokens-provider-purpose"> · {providerGroupSubtitleKeys({ info: group.info, copy: ACCESS_TOKEN_PROVIDER_COPY }).map(controller.t).join(" · ")}</span>
      </h3>
      {group.info.unlisted ? <p className="field-hint">{controller.t("Its plugin is off or missing. You can still remove saved tokens.")}</p> : null}
      {group.rows.map((row) => (
        <TokenRow bindings={bindings} key={row.row.id} state={row} info={group.info} controller={controller} groupRowCount={group.rows.length} t={controller.t} />
      ))}
      {!hasRows && !group.addForm.visible ? <NotConnectedRow bindings={bindings} ref={ref} label={group.info.label} onConnect={() => controller.openAddForm(ref)} t={controller.t} /> : null}
      {group.addForm.visible ? <AddTokenForm bindings={bindings} info={group.info} state={group.addForm} controller={controller} t={controller.t} /> : null}
      {/* No `[+ Add another]` for a `"custom"` group — it has no shared provider identity a second
          saved row could join; a second custom credential is a wholly new one, created through the
          standalone "Add custom provider" dialog, not this per-provider affordance. */}
      {/* Nor for an unlisted provider (plugin off or missing): it takes no new token. */}
      {hasRows && !group.addForm.visible && acceptsAnotherToken(group.info) ? <AddAnotherButton ref={ref} label={group.info.label} controller={controller} t={controller.t} /> : null}
    </section>
  );
}

function AddAnotherButton({ ref, label, controller, t: translate }: { ref: AccessTokenProviderRef; label: string; controller: AccessTokensController; t: Translate }) {

  return (
    <button
      type="button"
      className="link-button access-tokens-add-another"
      onClick={() => controller.openAddForm(ref)}
      {...agentHandle({ handle: `security-access-tokens-add-${ref.kind}-${agentHandleSegment({ value: ref.providerId })}` }, { role: "button", label: `Add another ${label} token` })}
    >
      {translate("Add another")} <span translate="no">{label}</span> {translate("token")}
    </button>
  );
}

function NotConnectedRow({ bindings, ref, label, onConnect, t: translate }: { bindings: AccessTokensTabBindings; ref: AccessTokenProviderRef; label: string; onConnect: () => void; t: Translate }) {
  const { DisclosureChevronIcon } = bindings.kit;

  return (
    <div className="access-tokens-row">
      <div className="access-tokens-row-summary">
        <span className="access-tokens-row-marker" aria-hidden="true" />
        <span className="access-tokens-row-name">{translate("Not connected")}</span>
        <button
          type="button"
          className="access-tokens-row-summary-expand"
          onClick={onConnect}
          // `aria-label`, not just the visible "Connect" text: every not-yet-connected provider on
          // this page renders this exact same bare word, so with two or more not-connected rows on
          // screen at once (the common case — most installs have not connected every one of the
          // seven providers), `getByRole("button", { name: "Connect" })` — or an agent resolving by
          // accessible name — cannot tell GitHub's row from GitLab's. `label` here is already the
          // provider's own display label (e.g. "GitHub Pages"), so this starts with the exact
          // visible word (WCAG 2.5.3 Label in Name).
          aria-label={`${translate("Connect")} ${label}`}
          // Handle built from `ref.kind`/`ref.providerId` (already lowercase, hyphen-safe — every
          // `AccessTokenProviderRef` in this app comes straight off `ACCESS_TOKEN_PROVIDERS`), never
          // from `label` — `agentHandle()` rejects any handle that isn't lowercase words joined by
          // single hyphens, and a proper-noun label like "GitHub Pages" (capitals, a space) throws
          // at render time. Caught live: an uncaught throw here unmounted this whole row with no
          // error boundary above it, which is worse than a defensive check — a crash, not a fallback.
          {...agentHandle({ handle: `security-access-tokens-connect-${ref.kind}-${agentHandleSegment({ value: ref.providerId })}` }, { role: "button", label: `Connect ${label}` })}
        >
          {translate("Connect")}
          <DisclosureChevronIcon />
        </button>
      </div>
    </div>
  );
}

function AccessTokensLoaded({ bindings, controller, otherController, addCustomDialogRef, merged }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; otherController: OtherCredentialsController; addCustomDialogRef: import("react").RefObject<HTMLDialogElement | null>; merged: ReturnType<typeof useMergedSecretsOrder> }, _optional: Record<string, never> = {}) {
  const { OtherCredentialEntry } = bindings.kit;
  return (
<>
      <AccessTokensSearch bindings={bindings} controller={controller} otherController={otherController} />
      <AccessTokensCategoryFilter bindings={bindings} controller={controller} onAddCustomProvider={() => addCustomDialogRef.current?.showModal()} />
      <HostingPluginsHint bindings={bindings} controller={controller} />
      <div className="access-tokens-tier">
        {merged.length === 0 && !controller.query && !controller.loadError && !otherController.loadError ? <div className="empty-state"><p>{controller.t("Not connected")}</p></div> : null}
        {merged.map((entry) =>
          entry.kind === "provider" ? (
            <ProviderGroup bindings={bindings} key={entry.key} group={entry.group} controller={controller} />
          ) : (
            <OtherCredentialEntry key={entry.key} store={entry.store} row={entry.row} controller={otherController} />
          )
        )}
      </div>
      <AddCustomCredentialDialog bindings={bindings} ref={addCustomDialogRef} controller={controller} t={controller.t} />
    </>
  );
}

function AccessTokensCategoryItems({ bindings, controller, translate }: { bindings: AccessTokensTabBindings; controller: AccessTokensController; translate: Translate }, _optional: Record<string, never> = {}) {
  const { ACCESS_TOKEN_CATEGORIES, resolveTabBarTabIndex } = bindings.deps;
  return (<>
{ACCESS_TOKEN_CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          className="access-tokens-category-filter-item"
          aria-selected={controller.category === c.id}
          tabIndex={resolveTabBarTabIndex({ tabs: ACCESS_TOKEN_CATEGORIES, activeId: controller.category, tab: c })}
          onClick={() => controller.setCategory(c.id as AccessTokenCategoryId)}
          {...agentHandle({ handle: `security-access-tokens-category-${c.id}` }, { role: "button", label: `Filter the credential list to ${c.label}` })}
        >
          {translate(c.label)}
        </button>
      ))}
  </>);
}

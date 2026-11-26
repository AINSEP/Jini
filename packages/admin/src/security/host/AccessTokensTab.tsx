import { type ComponentType, type KeyboardEventHandler } from "react";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";
import type { asciiSlug } from "../../shell/lib/ascii-slug.js";
import type { AdminPublishTargetField } from "../../deployment/api/deployment-api.types.js";
import type { AccessTokenCategoryId, AccessTokenCategoryInfo } from "../access-token-categories.js";
import { type AccessTokenProviderInfo, type AccessTokenProviderCopy } from "../access-token-providers.js";
import type { AccessTokensController } from "./hooks/use-access-tokens.hooks.js";
import type { OtherCredentialsController, OtherCredentialRowState, OtherCredentialStoreInfo } from "./hooks/use-other-credentials.hooks.js";
import type { useRemoveConfirmDialog, useAddCustomCredentialDialog, useMergedSecretsOrder } from "./AccessTokensTab.hooks.js";
import { CopyKeysDialog } from "./CopyKeysDialog.js";
import type { CopyKeysController } from "./hooks/use-copy-keys.hooks.js";
import { AccessTokensBody } from "./AccessTokensGroups.js";

export interface AccessTokensTabBindings {
  hooks: {
    useAdminLocaleHook: () => string;
    useAccessTokensHook: () => AccessTokensController;
    useOtherCredentialsHook: (required: { query: string; category: AccessTokenCategoryId }) => OtherCredentialsController;
    useCopyKeysHook: (required: { t: Translate }) => CopyKeysController;
    useMergedSecretsOrderHook: typeof useMergedSecretsOrder;
    useRemoveConfirmDialogHook: typeof useRemoveConfirmDialog;
    useAddCustomCredentialDialogHook: typeof useAddCustomCredentialDialog;
    useTabBarKeyboardHook: (required: { tabs: readonly AccessTokenCategoryInfo[]; activeId: string; onChange: (id: string) => void }) => { onKeyDown: KeyboardEventHandler<HTMLElement> };
  };
  kit: {
    SecretInput: typeof import("../../shell/components/SecretInput/SecretInput.js").SecretInput;
    CredentialHint: ComponentType<{ hint: CredentialTokenHint | null | undefined }>;
    OnboardingChipField: ComponentType<{ multiple: true; label: string; options: { value: string; label: string }[]; value: string[]; onChange: (value: string[]) => void }>;
    OtherCredentialEntry: ComponentType<{ store: OtherCredentialStoreInfo; row: OtherCredentialRowState | undefined; controller: OtherCredentialsController }>;
    ConnectedMarkIcon: ComponentType<{ size?: number }>;
    DisclosureChevronIcon: ComponentType<{ size?: number }>;
    SearchIcon: ComponentType<{ size?: number }>;
  };
  deps: {
    asciiSlug: typeof asciiSlug;
    ACCESS_TOKEN_CATEGORIES: readonly AccessTokenCategoryInfo[];
    ACCESS_TOKEN_PROVIDER_COPY: AccessTokenProviderCopy;
    showCopyKeysEntry: boolean;
    viewerTimeZone: string | undefined;
    removeLabel: string;
    customCredentialBaseUrlPlaceholder: string;
    removeTokenHandleLabel: (required: { provider: string }) => string;
    storedTokenNotice: string;
    hostingPluginsHref: string;
    providerGroupHandleLabel: (required: { info: AccessTokenProviderInfo; connectedCount: number }) => string;
    tokenRowHandleLabel: (required: { name: string; providerLabel: string }) => string;
    fieldNameHandleSegment: (required: { fieldName: string; asciiSlug: typeof asciiSlug }) => string;
    fieldHelpText: (required: { field: AdminPublishTargetField }) => string;
    accessTokenExtraFieldIdSuffix: (required: { deps: { asciiSlug: typeof asciiSlug; fieldNameHandleSegment: AccessTokensTabBindings["deps"]["fieldNameHandleSegment"] }; fieldName: string }) => string;
    resolveTabBarTabIndex: (required: { tabs: readonly AccessTokenCategoryInfo[]; activeId: string; tab: AccessTokenCategoryInfo }) => number;
    otherCredentialMatchesQuery: Parameters<typeof useMergedSecretsOrder>[0]["deps"]["otherCredentialMatchesQuery"];
    accessTokensCountText: (required: { totalCount: number; matchCount: number; query: string }, optional: { t: Translate }) => string;
    removeDialogTitle: (required: { locale: string; name: string }) => string;
    removeDialogBody: (required: { locale: string; credentialLabel: string; vendor: string }) => string;
  };
}

export interface AccessTokensTabProps extends AccessTokensTabBindings {
  showCopyKeysEntry?: boolean;
}

/**
 * @file The Access Tokens tab — `Security.tsx`'s one tab and this feature's actual content. One
 * flat, searchable, category-filtered list of every credential this install holds across all eight
 * stores `development/todos.md:1208` names — the 2026-08-16 owner ruling that replaced this page's
 * original two-surface shape (seven Tier 1 providers here, a banner naming six unread Tier 2 stores)
 * with a single list: "from a person's point of view a Cloudinary key and a GitHub token are the
 * same kind of thing — a secret this install holds." See `ADS-memory/reports/design/
 * 2026-08-16-access-tokens-visual-spec.md`'s "OWNER RULING" section for the ruling in full.
 *
 * Tier 1 (`ACCESS_TOKEN_PROVIDERS`, `rules.ts`: the hosting and source-control providers) still gets `[+ Add]` and multiple operator-named rows per provider — the
 * genuinely new capability this page adds (see `Security.tsx`'s own header for why "Create" living
 * here is not a repeat of what Static Site/Source Control already do). Tier 2
 * (`OTHER_CREDENTIAL_STORES`, `rules.ts`, rendered by `OtherCredentialsSection.tsx`) gets Replace/
 * Remove and a deep link to wherever Create actually lives, never a second Create — the tier split
 * survives only as that per-row CAPABILITY difference now, not as two separate surfaces. The
 * "showing 7 of 8" partial-inventory banner this page used to render is deleted; there is nothing
 * left to disclose once every store is read.
 *
 * ## Search
 *
 * Matches a provider's/store's brand label, its purpose subtitle ("Hosting"/"Source control"/
 * "AI"/… — the disambiguation `rules.ts`'s header calls "the two-store GitHub trap" for Tier 1, and
 * the same subtitle Tier 2 rows carry next to their own name), and a saved item's own name. A group
 * renders when EITHER its own info matches the query OR it has at least one matching saved row — so
 * typing "GitHub" surfaces both the GitHub Pages group (provider match) and the GitHub · Source
 * Control group (provider match), each rendering its own real rows, never merged into one card.
 *
 * ## Category filter
 *
 * `All / Source control / Hosting / Media / AI / Ops` (`rules.ts`'s `ACCESS_TOKEN_CATEGORIES`),
 * `All` default, borrowing Settings' wrapped icon-tab-row LOOK without adopting `SettingsDialogShell`
 * itself — that component bundles its own vertical sidebar plus a kicker/title/subtitle header that
 * fights this page's own `.page-header` (`Deployment.tsx`'s header documents the same rejection for
 * the identical reason). `.access-tokens-category-filter` is its own class, not an overload of
 * `.tab-bar` — a filter control, not a tab bar, and `.tab-bar` is shared by five other screens that
 * must not be affected by this page's own styling needs.
 *
 * ## Component split
 *
 * Per-scope ESLint complexity gate (hard 9/9 cyclomatic/cognitive) — same "extract, don't inline"
 * discipline `ProvidersTab.tsx`/`StaticSiteTab.tsx` already use for the identical reason.
 */

export function AccessTokensTab({ hooks, kit, deps, ...props }: AccessTokensTabProps, _optional: Record<string, never> = {}) {
  const bindings = { hooks, kit, deps };
  const { showCopyKeysEntry } = deps;
  const { useAdminLocaleHook, useAccessTokensHook, useOtherCredentialsHook, useCopyKeysHook } = hooks;
  useAdminLocaleHook();

  const controller = useAccessTokensHook();
  // Tier 2 reads `query`/`category` FROM Tier 1's own controller rather than owning either — one
  // search box, one category filter, across both tiers (this file's own header). See
  // `use-other-credentials.hooks.ts`'s header for why that state isn't duplicated here instead.
  const otherController = useOtherCredentialsHook({ query: controller.query, category: controller.category });

  const copyDialog = useCopyKeysHook({ t: controller.t });

  return (
    <div
      className="access-tokens-tab"
      {...agentHandle({ handle: "security-access-tokens" }, {
        role: "region",
        label: "Every access token and other saved credential this install holds, across all eight stores, searchable and filterable by category",
      })}
    >
      {/* Owner 2026-11-08: back on ("be able to share keys among databases") after being hidden
          2026-10-11. Same picker and route as the chat card. */}
      {(props.showCopyKeysEntry ?? showCopyKeysEntry) ? (
        <>
          <button type="button" className="btn-secondary" onClick={copyDialog.show}>{controller.t("Use a saved key")}</button>
          <CopyKeysDialog dialog={copyDialog} t={controller.t} />
        </>
      ) : null}
      <AccessTokensBody bindings={bindings} controller={controller} otherController={otherController} />
    </div>
  );
}

export function bindAccessTokensTab(bindings: Omit<AccessTokensTabBindings, "hooks"> & {
  hooks: Omit<AccessTokensTabBindings["hooks"], "useOtherCredentialsHook">;
}, _optional: Record<string, never> = {}) {
  return function BoundAccessTokensTab({ useAdminLocaleHook = bindings.hooks.useAdminLocaleHook,
    useAccessTokensHook = bindings.hooks.useAccessTokensHook, useOtherCredentialsHook,
    useCopyKeysHook = bindings.hooks.useCopyKeysHook, ...props }: {
    useAdminLocaleHook?: AccessTokensTabBindings["hooks"]["useAdminLocaleHook"];
    useAccessTokensHook?: AccessTokensTabBindings["hooks"]["useAccessTokensHook"];
    useOtherCredentialsHook: AccessTokensTabBindings["hooks"]["useOtherCredentialsHook"];
    useCopyKeysHook?: AccessTokensTabBindings["hooks"]["useCopyKeysHook"];
    showCopyKeysEntry?: boolean;
  }, _optional: Record<string, never> = {}) {
    return <AccessTokensTab {...props} kit={bindings.kit} deps={bindings.deps}
      hooks={{ ...bindings.hooks, useAdminLocaleHook, useAccessTokensHook, useOtherCredentialsHook, useCopyKeysHook }} />;
  };
}

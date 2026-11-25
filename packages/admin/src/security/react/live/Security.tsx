import type { ComponentType } from "react";
import type { TabBarProps, TabBarTab } from "../../../react/kit.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { resolveActiveTabId, type Translate } from "@jini-ai/core/text";

const ACCESS_TOKENS_TAB = "access-tokens";

/**
 * ## The site key tab is affordance-hidden, not just protected server-side (2026-09-10)
 *
 * Every site-key route already re-checks `admin.security.site-key.manage` server-side
 * (`site-key-permission.ts`'s own header) — that gate was never the gap. Until this pass, the
 * TAB itself rendered for every logged-in admin-panel user regardless of role, so an editor/viewer
 * saw a tab that would 403 on every action inside it. `useWiredSecurityPermissions` (`hooks/
 * use-security-permissions.hooks.ts`) reads the same permission client-side, UX-only
 * (`Jini packages/ui/src/features/panel-kit/helpers/permissions.ts`'s `hasPermission` — its own header states plainly this is not the security
 * boundary): the tab entry, the rendered `<SiteKeyTab />`, and a direct `?tab=site-key` link all
 * fall back to Access Tokens for a principal who does not hold it. `resolveSecurityTabId` treats a
 * still-loading permission read as "not permitted" (`hasPermission` naturally returns `false` for
 * empty/absent permissions), so the tab never flashes into view before disappearing.
 */

const SECURITY_TAB_IDS = [ACCESS_TOKENS_TAB, "site-key"] as const;
type SecurityTabId = (typeof SECURITY_TAB_IDS)[number];

/** The tab-id list for a principal WITHOUT `admin.security.site-key.manage` — see this file's header
 *  ("The site key tab is affordance-hidden") for why {@link resolveSecurityTabId} needs a second,
 *  narrower list rather than only ever validating against {@link SECURITY_TAB_IDS}. */
const ACCESS_TOKENS_ONLY_TAB_IDS: readonly SecurityTabId[] = [ACCESS_TOKENS_TAB];

/** Falls back to the Access Tokens tab for an absent or unrecognized `?tab=` value, delegating to
 *  the shared `../../lib/resolve-active-tab-id` guard `Deployment.tsx`/`SourceControl.tsx`/
 *  `Database.tsx`/`Themes.tsx` all use — AND, since 2026-09-10, for a `?tab=site-key` link
 *  followed by a principal who does not hold `admin.security.site-key.manage`: `validIds` narrows to
 *  {@link ACCESS_TOKENS_ONLY_TAB_IDS} for them, so `site-key` reads as just as "unrecognized" as a
 *  typo would, and they land on Access Tokens instead of an empty panel. */
function resolveSecurityTabId({ tabId, canManageSiteKey }: { tabId: string | null | undefined; canManageSiteKey: boolean }, _optional: Record<string, never> = {}): SecurityTabId {
  const validIds: readonly SecurityTabId[] = canManageSiteKey ? SECURITY_TAB_IDS : ACCESS_TOKENS_ONLY_TAB_IDS;
  return resolveActiveTabId({ tabId: tabId, validIds: validIds, defaultId: ACCESS_TOKENS_TAB });
}

export interface SecurityProps {
  tabId?: string | null;
  useAdminLocaleHook: () => string;
  useSecurityPermissionsHook: () => { canManageSiteKey: boolean };
  kit: {
    TabBar: ComponentType<TabBarProps>;
    AccessTokensIcon: ComponentType<{ size: number }>;
    SiteKeyIcon: ComponentType<{ size: number }>;
  };
  panels: {
    AccessTokens: ComponentType;
    SiteKey: ComponentType;
    Totp: ComponentType<{ translate: Translate }>;
    RecoveryCodes: ComponentType<{ t: Translate }>;
    Passkeys: ComponentType<{ translate: Translate }>;
  };
  copy: {
    t: (required: { locale: string; key: string }, optional?: Record<string, never>) => string;
    headerHandleLabel: string;
    accessTokensHandleLabel: string;
  };
  onTabChange: (required: { nextTabId: string }, optional?: Record<string, never>) => void;
}

function securityTabs({ canManageSiteKey, locale, kit, copy }: Pick<SecurityProps, "kit" | "copy"> & { canManageSiteKey: boolean; locale: string }): TabBarTab[] {
  const { AccessTokensIcon, SiteKeyIcon } = kit;
  const { t } = copy;
  return [
    {
      id: ACCESS_TOKENS_TAB,
      label: t({ locale: locale, key: "Access Tokens" }),
      icon: <AccessTokensIcon size={16} />,
      handle: "security-tab-access-tokens",
      handleLabel: copy.accessTokensHandleLabel,
    },
    ...(canManageSiteKey
      ? [
          {
            id: "site-key",
            label: t({ locale: locale, key: "Site key" }),
            icon: <SiteKeyIcon size={16} />,
            handle: "security-tab-site-key",
            handleLabel: t({ locale: locale, key: "Switch to the site key tab" }),
          } satisfies TabBarTab,
        ]
      : []),
  ];
}

export function Security({ tabId, useAdminLocaleHook, useSecurityPermissionsHook, kit, panels, copy, onTabChange }: SecurityProps) {
  const locale = useAdminLocaleHook();
  const { canManageSiteKey } = useSecurityPermissionsHook();
  const activeTabId = resolveSecurityTabId({ tabId, canManageSiteKey });
  const tabs = securityTabs({ canManageSiteKey, locale, kit, copy });
  const { TabBar } = kit;
  const { AccessTokens, SiteKey, Totp, RecoveryCodes, Passkeys } = panels;
  const { t } = copy;

  return (
    <div className="page">
      <div
        className="page-header"
        {...agentHandle({ handle: "security-header" }, {
          role: "region",
          label: copy.headerHandleLabel,
        })}
      >
        <div className="page-header-text">
          <p className="page-kicker">{t({ locale: locale, key: "Operations" })}</p>
          <h1 className="page-title">{t({ locale: locale, key: "Secrets" })}</h1>
          <p className="page-description">
            {t({ locale: locale, key: "One place to see every access token this install holds, and create, rotate, or remove one without hunting across the screens that created it." }
            )}
          </p>
        </div>
      </div>
      <Totp translate={key => t({ locale, key })} />
      <RecoveryCodes t={key => t({ locale, key })} />
      <Passkeys translate={key => t({ locale, key })} />
      <TabBar
        ariaLabel={t({ locale: locale, key: "Secrets" })}
        tabs={tabs}
        activeId={activeTabId}
        onChange={(nextTabId) => onTabChange({ nextTabId }, {})}
        containerHandle="security-tab-bar"
      />
      {activeTabId === ACCESS_TOKENS_TAB ? <AccessTokens /> : null}
      {activeTabId === "site-key" ? <SiteKey /> : null}
    </div>
  );
}

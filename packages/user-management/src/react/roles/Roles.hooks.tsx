import type { TabBarTab } from "@jini-ai/ui/tab-strip";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { resolveActiveTabId } from "@jini-ai/ui/panel-kit";

const LINE_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function RolesIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
    </svg>
  );
}

export function PoliciesIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M12 3l7 2.5v6c0 4-3 7.4-7 8.5-4-1.1-7-4.5-7-8.5v-6z" />
      <path d="M9.5 11.5h5M9.5 14.5h3" />
    </svg>
  );
}

export const ROLES_TAB_IDS = ["roles", "policies"] as const;
export type RolesTabId = (typeof ROLES_TAB_IDS)[number];

export function resolveRolesTabId({ tabId }: { tabId: string | null | undefined }): RolesTabId {
  return resolveActiveTabId({ tabId, validIds: ROLES_TAB_IDS, defaultId: "roles" });
}

export function resolveRolesTabs({ translate: t }: { translate: Translate }): TabBarTab[] {
  return [
    {
      id: "roles",
      label: t("Roles"),
      icon: <RolesIcon />,
      handle: "roles-tab-roles",
      handleLabel: t("Switch to the Roles tab — list, create, rename and delete the roles a person can be assigned"),
    },
    {
      id: "policies",
      label: t("Policies"),
      icon: <PoliciesIcon />,
      handle: "roles-tab-policies",
      handleLabel: t("Switch to the Policies tab — list and create policies, and add or remove the individual permissions on each one"),
    },
  ];
}

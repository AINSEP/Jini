import type { AdminIdentityUser, AdminRole, AdminPolicy, AdminMember } from "../models.js";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { describeIdentityError } from "../errors.js";
import type { RowMenuItem } from "@jini-ai/admin/react";
import type { QueryKey } from "@jini-ai/ui/panel-kit";

export const KEYS = {
  list: ["users-roles-policies"] as QueryKey,
};

const STATIC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  GRANT_EXCEEDS_ISSUER: "You cannot grant a permission you do not hold.",
  FORBIDDEN: "You do not have permission to do that.",
  RESOURCE_CONFLICT: "That username is already in use.",
  OWNER_REQUIRED: "The workspace must keep at least one active owner.",

  SELF_DELETE: "You cannot delete your own account.",
  USER_IN_TRASH: "This user is in the Trash; restore them first.",
  USERNAME_IN_TRASH: "A user with this username is in the Trash; restore or delete them permanently first.",
};

export function describeApiError({ error, fallback, translate }: { error: unknown; fallback: string; translate: Translate }): string {
  return describeIdentityError({ error, fallback, translate }, { messages: STATIC_ERROR_MESSAGES });
}

export interface UserRowMenuHandlers {

  onRequestDisable: (user: AdminIdentityUser) => void;

  onEnable: (user: AdminIdentityUser) => void;
  onManage: (user: AdminIdentityUser) => void;
  onResetPassword: (user: AdminIdentityUser) => void;

  onRequestDelete: (user: AdminIdentityUser) => void;
}

export function userRowMenuItems({ user, toggleSaving, handlers, translate, canDelete }: {
  user: AdminIdentityUser; toggleSaving: boolean; handlers: UserRowMenuHandlers; translate: Translate; canDelete: boolean;
}): RowMenuItem[] {
  const items: RowMenuItem[] = [
    {
      key: "toggle",
      label: user.status === "active" ? translate("Disable") : translate("Enable"),
      tone: user.status === "active" ? "warning" : "default",
      onSelect: () => {
        if (toggleSaving) return;
        if (user.status === "active") {
          handlers.onRequestDisable(user);
        } else {
          handlers.onEnable(user);
        }
      },
    },
    {
      key: "manage",
      label: translate("Manage"),
      onSelect: () => handlers.onManage(user),
    },
    {
      key: "reset-password",
      label: translate("Reset password"),
      tone: "warning",
      onSelect: () => handlers.onResetPassword(user),
    },
  ];
  if (canDelete) {
    items.push({
      key: "delete",
      label: translate("Delete"),
      tone: "danger",
      onSelect: () => handlers.onRequestDelete(user),
    });
  }
  return items;
}

export function formatGrantLabel({ ids, byId }: { ids: readonly string[]; byId: ReadonlyMap<string, { name: string }> }): string | null {
  if (ids.length === 0) return null;
  return ids.map((id) => byId.get(id)?.name ?? id).join(", ");
}

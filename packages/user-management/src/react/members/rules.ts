import type { AdminIdentityUser, AdminRole, AdminPolicy, AdminMember } from "../models.js";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { describeIdentityError } from "../errors.js";
import type { RowMenuItem } from "@jini-ai/admin/react";

const STATIC_ERROR_MESSAGES = { FORBIDDEN: "You do not have permission to do that." };

export interface RowActionState {
  disabling: boolean;
  resending: boolean;
  error: string | null;
  notice: string | null;
}

export function emptyRowState(_required: Record<string, never>): RowActionState {
  return { disabling: false, resending: false, error: null, notice: null };
}

export function describeApiError({ error, fallback, translate }: { error: unknown; fallback: string; translate: Translate }): string {
  return describeIdentityError({ error, fallback, translate }, { messages: STATIC_ERROR_MESSAGES });
}

export interface MemberRowMenuHandlers {
  onResendSignInLink: (member: AdminMember) => void;

  onRequestDisable: (member: AdminMember) => void;
}

export function memberRowMenuItems({ member, rs, handlers, translate }: {
 member: AdminMember; rs: RowActionState; handlers: MemberRowMenuHandlers; translate: Translate;
}): RowMenuItem[] {
  const items: RowMenuItem[] = [
    {
      key: "resend",
      label: translate("Resend sign-in link"),
      onSelect: () => {
        if (rs.resending) return;
        handlers.onResendSignInLink(member);
      },
    },
  ];
  if (member.status !== "disabled") {
    items.push({
      key: "disable",
      label: translate("Disable"),
      tone: "warning",
      onSelect: () => {
        if (rs.disabling) return;
        handlers.onRequestDisable(member);
      },
    });
  }
  return items;
}

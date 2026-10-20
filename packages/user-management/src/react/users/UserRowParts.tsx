import type { ReactNode } from "react";
import type { RowMenuItem } from "@jini-ai/admin/react";
import { agentHandle } from "@jini-ai/agentic";
import type { Translate } from "@jini-ai/ui/panel-kit";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../models.js";
import { formatGrantLabel, userRowMenuItems } from "./rules.js";
import type { UserRowActionsController } from "./Users.js";

/**
 * @file The cells and menu-item wiring of `Users.tsx`'s `UserRow`, split out of it in the
 * complexity-ceiling pass (lot L182a): `UserRow` scored cyclomatic 16 with every cell's own
 * fallback (`isOwn`, the status/role `renderServerLabel ?? …` chains, the two "none" placeholders,
 * the rename/capability optional calls) counted against the row itself. Each piece below now owns
 * its own branches; the markup each one renders is exactly what `UserRow` rendered inline before.
 */

type ServerLabelRenderer = ((required: { value: string }) => ReactNode) | undefined;

export interface UserNameCellProps {
  user: AdminIdentityUser;
  isOwn: boolean | undefined;
  expanded: boolean;
  onToggle: (user: AdminIdentityUser) => void;
  agentBase: string;
  t: (key: string) => string;
}

/** The username cell: the Manage toggle button plus the "(you)" marker on the caller's own row. */
export function UserNameCell({ user, isOwn, expanded, onToggle, agentBase, t }: UserNameCellProps) {
  return (
    <td>
      {/* Two affordances, one behavior: this and the RowMenu's "Manage" item both
          call `toggleExpanded` directly rather than duplicating its logic. A real
          `<button>`, not `<a href="#">` — this doesn't navigate anywhere, it only
          toggles the panel below, and an anchor with no real target is its own
          accessibility smell. The visible text is the username itself, so the
          accessible name already identifies which user this manages — no need for a
          separate "Manage user ..." label duplicating what's already legible.
          `aria-expanded` mirrors `Members.tsx`'s identical email-toggle-button
          convention for the same shape of control. */}
      <button
        type="button"
        className="link-button"
        onClick={() => onToggle(user)}
        aria-expanded={expanded}
        {...agentHandle({ handle: `${agentBase}-manage` }, {
          role: "button",
          label: "Open this user's Manage panel — edit email, assign a role, attach a policy",
        })}
      >
        {user.username}
      </button>
      {isOwn ? <span style={{ color: "var(--jini-text-secondary)", fontSize: "inherit", fontWeight: 400, marginInlineStart: "0.35em" }}>{t("(you)")}</span> : null}
    </td>
  );
}

export interface UserStatusCellProps {
  status: AdminIdentityUser["status"];
  t: (key: string) => string;
  renderServerLabel: ServerLabelRenderer;
}

/** The status badge cell — the host's `renderServerLabel` wins, falling back to `t(status)`. */
export function UserStatusCell({ status, t, renderServerLabel }: UserStatusCellProps) {
  return (
    <td>
      <span className={`status status-${status}`}>{renderServerLabel?.({ value: status }) ?? t(status)}</span>
    </td>
  );
}

export interface UserGrantCellsProps {
  user: AdminIdentityUser;
  roleById: ReadonlyMap<string, AdminRole>;
  policyById: ReadonlyMap<string, AdminPolicy>;
  t: (key: string) => string;
  translate: Translate;
  renderServerLabel: ServerLabelRenderer;
}

/** The Roles and Policies cells, each a joined label or a muted "none". As before the split, only
 *  the role label is offered to `renderServerLabel`; the policy label renders as-is. */
export function UserGrantCells({ user, roleById, policyById, t, translate, renderServerLabel }: UserGrantCellsProps) {
  const roleLabel = formatGrantLabel({ ids: user.roleIds, byId: roleById, translate });
  const policyLabel = formatGrantLabel({ ids: user.policyIds, byId: policyById });
  return (
    <>
      <td>{roleLabel !== null ? (renderServerLabel?.({ value: roleLabel }) ?? roleLabel) : <span className="muted-cell">{t("none")}</span>}</td>
      <td>{policyLabel !== null ? policyLabel : <span className="muted-cell">{t("none")}</span>}</td>
    </>
  );
}

/** `rules.ts`'s `userRowMenuItems`, wired to one row's {@link UserRowActionsController}. The
 *  `?? actions.canDelete` capability fallback is a permission default for a controller with no
 *  per-row `rowCapabilities` — kept, not "simplified away" (the server stays the real boundary). */
export function userRowMenuItemsFor({ user, actions, translate }: {
  user: AdminIdentityUser; actions: UserRowActionsController; translate: Translate;
}): RowMenuItem[] {
  return userRowMenuItems({
    user, toggleSaving: actions.savingId === user.principalId,
    handlers: {
      onRequestDisable: actions.requestDisable,
      onEnable: (u) => void actions.toggleStatus(u),
      onManage: actions.toggleExpanded,
      onResetPassword: actions.openResetPassword,
      onChangeUsername: actions.renameUserHandler?.({ user }),
      onRequestDelete: actions.requestDelete,
    }, translate, canDelete: actions.canDelete,
    capabilities: actions.rowCapabilities?.(user) ?? actions.canDelete,
  });
}

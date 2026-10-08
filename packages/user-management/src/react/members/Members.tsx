import { Fragment } from "react";
import { RowMenu, ConfirmDialog } from "@jini-ai/admin/react";
import { agentHandle } from "@jini-ai/agentic";
import type { AdminMember } from "../models.js";
import { formatTimestamp } from "@jini-ai/ui/panel-kit";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { buildAgentListHandles } from "@jini-ai/ui/panel-kit";

import { memberRowMenuItems, type RowActionState } from "./rules.js";
import { useMembers, type MembersDependencies, type MembersOptions } from "./hooks/use-members.hooks.js";
import type { ReactNode } from "react";

/**
 * @file Admin "Members" screen (ADR-030, ADR-PIPE-013 Decision §7) — markup only.
 *
 * State and API calls live in `hooks/use-members.hooks.ts`; the row-menu logic, per-row action
 * state shape, and the server-error-message override live in `rules.ts`. What stays here is what
 * actually renders: the table and the confirm dialog.
 *
 * Mirrors `features/posts/Posts.tsx`'s fetch/loading/error/table shape. Adds the
 * three row-level actions this remediation wires up (T039): disable, resend
 * sign-in link, and a click-to-expand detail panel — all calling the 3
 * already-existing, already-unused `apps/admin/src/lib/api.ts` client methods
 * (`disableMember`, `requestMemberMagicLink`, `getMember`). No new backend
 * contract needed. Pagination is explicitly deferred (ADR-PIPE-013 Decision
 * §7) — not part of this screen yet.
 *
 * Per-row in-flight state disables only the clicked control (not the whole
 * table), and errors surface via the existing `notice error` convention
 * (inline per row for actions; a full-width banner for the initial load).
 * Stays a single flat file, matching every other admin section's convention.
 */
export interface MembersProps extends MembersDependencies, MembersOptions {
  useMembersHook?: typeof useMembers | undefined;
  /** Host terminology is copy, not a second members lifecycle. */
  description?: string | undefined;
  emptyDescription?: string | undefined;
  renderServerLabel?: ((required: { value: string }) => ReactNode) | undefined;
}

interface MemberDetailPanelProps {
  memberId: string;
  detailLoadingId: string | null;
  detailError: string | null;
  detail: AdminMember | undefined;
  t: Translate;
}

/** The expanded row's detail panel — one of "loading" / "error" / the fetched fields / nothing
 *  yet, extracted out of `MemberRow` so its three-way branch isn't counted in `MemberRow`'s own
 *  scope. Same "the panel, not the row, was the actual size" split `Users.tsx`'s
 *  `UserRow` -> `UserManagePanel` and `Roles.tsx`'s `PolicyRow` -> `PolicyRowActions` already use. */
function MemberDetailPanel({ memberId, detailLoadingId, detailError, detail, t }: MemberDetailPanelProps) {
  if (detailLoadingId === memberId) return <div className="notice">{t("Loading detail…")}</div>;
  if (detailError) return <div className="notice error">{detailError}</div>;
  if (!detail) return null;
  return (
    <dl className="member-detail">
      <dt>{t("ID")}</dt>
      <dd>{detail.id}</dd>
      <dt>{t("Email verified")}</dt>
      <dd>{detail.emailVerifiedAt ?? t("not verified")}</dd>
      <dt>{t("Updated")}</dt>
      <dd>{detail.updatedAt}</dd>
      <dt>{t("Version")}</dt>
      <dd>{detail.version}</dd>
    </dl>
  );
}

interface MemberRowProps {
  member: AdminMember;
  rowState: RowActionState;
  isExpanded: boolean;
  detail: AdminMember | undefined;
  detailError: string | null;
  detailLoadingId: string | null;
  onToggleDetail: (member: AdminMember) => Promise<void>;
  onResendSignInLink: (member: AdminMember) => Promise<void>;
  setConfirmingDisable: (member: AdminMember) => void;
  /** This row's own distinct handle base — computed once, across every rendered row, by `Members`
   *  (via `buildAgentListHandles`); see `Users.tsx`'s `UserRowProps.agentBase` for why a
   *  per-instance uniqueness search does not work here. */
  agentBase: string;
  t: Translate;
  translate: Translate;
  renderServerLabel?: MembersProps["renderServerLabel"];
}

/** One member's row plus its optional expanded detail row — extracted from `Members`'s
 *  `.map()` body verbatim, same convention `Users.tsx`'s `UserRow`/`Roles.tsx`'s `PolicyRow` use.
 *  `key` lives on the `<MemberRow>` element at the call site. */
function MemberRow({
  member,
  rowState,
  isExpanded,
  detail,
  detailError,
  detailLoadingId,
  onToggleDetail,
  onResendSignInLink,
  setConfirmingDisable,
  agentBase,
  t,
  translate,
  renderServerLabel,
}: MemberRowProps) {
  return (
    <Fragment key={member.id}>
      <tr>
        <td>
          <button
            type="button"
            className="link-button"
            onClick={() => void onToggleDetail(member)}
            aria-expanded={isExpanded}
            {...agentHandle({ handle: `${agentBase}-toggle-detail` }, { role: "button", label: `Expand or collapse ${member.email}'s detail panel` })}
          >
            {member.email}
          </button>
        </td>
        <td>{member.name ?? "—"}</td>
        <td>
          <span className={`status status-${member.status}`}>{renderServerLabel?.({ value: member.status }) ?? t(member.status)}</span>
        </td>
        <td>{formatTimestamp({ iso: member.createdAt })}</td>
        <td>
          <RowMenu
            triggerLabel={`${t("Actions for member")} "${member.email}"`}
            agentHandle={`${agentBase}-menu`}
            items={memberRowMenuItems({ member, rs: rowState, handlers: {
              onResendSignInLink: (m) => void onResendSignInLink(m),
              onRequestDisable: setConfirmingDisable,
            }, translate })}
          />
          {rowState.error ? (
            <div className="notice error" role="alert">
              {rowState.error}
            </div>
          ) : null}
          {rowState.notice ? <div className="notice">{rowState.notice}</div> : null}
        </td>
      </tr>
      {isExpanded ? (
        <tr>
          <td colSpan={5}>
            <MemberDetailPanel
              memberId={member.id}
              detailLoadingId={detailLoadingId}
              detailError={detailError}
              detail={detail}
              t={t}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function Members({ useMembersHook = useMembers, port, translate: injectedTranslate, refresh,
  description = "People who have registered an account — review status, resend a sign-in link, or disable access.",
  emptyDescription = "Registered members will show up here.", renderServerLabel }: MembersProps) {
  const {
    members,
    error,
    stateFor,
    onResendSignInLink,
    expandedId,
    detailById,
    detailError,
    detailLoadingId,
    onToggleDetail,
    confirmingDisable,
    setConfirmingDisable,
    confirmDisable,
    t,
    translate,
  } = useMembersHook({ port, translate: injectedTranslate }, { refresh });

  if (error) return <div className="notice error">{error}</div>;
  if (!members) return <div className="notice">{t("Loading members…")}</div>;

  // Member ids are stable and unique, so they disambiguate one row's menu from another's — same
  // reasoning as every other list on this workstream.
  const memberMenuBases = buildAgentListHandles({ prefix: "members-row", ids: members.map((member) => member.id) });

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("People")}</p>
          <h1 className="page-title">{t("Members")}</h1>
          <p className="page-description">
            {t(description)}
          </p>
        </div>
      </div>

      {members.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>{t("No members yet.")}</p>
            <p className="page-description">{t(emptyDescription)}</p>
          </div>
        </div>
      ) : (
      <div className="table-scroll">
      <table className="list-table">
        <thead>
          <tr>
            <th>{t("Email")}</th>
            <th>{t("Name")}</th>
            <th>{t("Status")}</th>
            <th>{t("Created")}</th>
            <th>{t("Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => (
            <MemberRow
              key={member.id}
              member={member}
              rowState={stateFor({ id: member.id })}
              isExpanded={expandedId === member.id}
              detail={detailById[member.id]}
              detailError={detailError}
              detailLoadingId={detailLoadingId}
              onToggleDetail={onToggleDetail}
              onResendSignInLink={onResendSignInLink}
              setConfirmingDisable={setConfirmingDisable}
              agentBase={memberMenuBases[index]!}
              t={t}
              translate={translate}
              renderServerLabel={renderServerLabel}
            />
          ))}
        </tbody>
      </table>
      </div>
      )}
      <ConfirmDialog
        cancelLabel={t("Cancel")}
        open={confirmingDisable !== null}
        agentHandle="members-disable"
        title={t("Disable this member?")}
        body={
          confirmingDisable ? (
            <p>
              {t("Disable")} &quot;{confirmingDisable.email}&quot;? {t("They will no longer be able to sign in.")}
            </p>
          ) : null
        }
        confirmLabel={t("Disable")}
        tone="warning"
        pending={confirmingDisable !== null && stateFor({ id: confirmingDisable.id }).disabling}
        onConfirm={confirmDisable}
        onCancel={() => setConfirmingDisable(null)}
      />
    </div>
  );
}

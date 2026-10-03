import { Fragment } from "react";
import { RowMenu, ConfirmDialog } from "@jini-ai/admin/react";
import { agentHandle } from "@jini-ai/agentic";
import type { AdminMember } from "../models.js";
import { formatTimestamp } from "@jini-ai/ui/panel-kit";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { buildAgentListHandles } from "@jini-ai/ui/panel-kit";

import { memberRowMenuItems, type RowActionState } from "./rules.js";
import { useMembers, type MembersDependencies, type MembersOptions } from "./hooks/use-members.hooks.js";

export interface MembersProps extends MembersDependencies, MembersOptions {

  useMembersHook?: typeof useMembers | undefined;
}

interface MemberDetailPanelProps {
  memberId: string;
  detailLoadingId: string | null;
  detailError: string | null;
  detail: AdminMember | undefined;
  t: Translate;
}

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

  agentBase: string;
  t: Translate;
  translate: Translate;
}

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
            {...agentHandle({ handle: `${agentBase}-toggle-detail` }, { role: "button", label: t(`Expand or collapse ${member.email}'s detail panel`) })}
          >
            {member.email}
          </button>
        </td>
        <td>{member.name ?? t("—")}</td>
        <td>
          <span className={`status status-${member.status}`}>{t(member.status)}</span>
        </td>
        <td>{formatTimestamp({ iso: member.createdAt })}</td>
        <td>
          <RowMenu
            triggerLabel={`${t("Actions for member")} "${member.email}"`}
            agentHandle={`${agentBase}-menu`}
            items={memberRowMenuItems({
              member,
              rs: rowState,
              handlers: {
                onResendSignInLink: (m) => void onResendSignInLink(m),
                onRequestDisable: setConfirmingDisable,
              },
              translate,
            })}
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

export function Members({ useMembersHook = useMembers, port, translate: injectedTranslate, refresh }: MembersProps) {
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

  const memberMenuBases = buildAgentListHandles({ prefix: "members-row", ids: members.map((member) => member.id) });

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("People")}</p>
          <h1 className="page-title">{t("Members")}</h1>
          <p className="page-description">
            {t(
              "People who have registered an account — review status, resend a sign-in link, or disable access.",
            )}
          </p>
        </div>
      </div>

      {members.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p>{t("No members yet.")}</p>
            <p className="page-description">{t("Registered members will show up here.")}</p>
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

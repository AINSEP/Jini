import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AdminMember } from "../../models.js";
import { describeApiError as describeFeatureError, emptyRowState, type RowActionState } from "../rules.js";
import { useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import type { MembersPort, IdentityRefreshPort } from "../../ports.js";
import type { Translate } from "@jini-ai/ui/panel-kit";

export interface MembersDependencies {
  port: MembersPort;
  translate: Translate;
}

export interface MembersController {

  members: AdminMember[] | null;
  error: string | null;

  stateFor: (required: { id: string }) => RowActionState;
  onResendSignInLink: (member: AdminMember) => Promise<void>;

  expandedId: string | null;

  detailById: Record<string, AdminMember>;
  detailError: string | null;
  detailLoadingId: string | null;
  onToggleDetail: (member: AdminMember) => Promise<void>;

  confirmingDisable: AdminMember | null;
  setConfirmingDisable: Dispatch<SetStateAction<AdminMember | null>>;
  confirmDisable: () => Promise<void>;

  t: Translate;

  translate: Translate;
}

export interface MembersOptions { refresh?: IdentityRefreshPort | undefined }
export function useMembers({ port, translate }: MembersDependencies, { refresh }: MembersOptions = {}): MembersController {
  const describeApiError = (error: unknown, fallback: string) => describeFeatureError({ error, fallback, translate });
  const t = translate;
  const boundT = translate;
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowActionState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, AdminMember>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [confirmingDisable, setConfirmingDisable] = useState<AdminMember | null>(null);
  const settlement = useSettlementGeneration();

  const expandedIdRef = useRef<string | null>(null);

  const detailSettlement = useSettlementGeneration();

  const load = useCallback(() => {

    const generation = settlement.next();
    port
      .listMembers({})
      .then((r) => {
        if (!settlement.isCurrent({ generation })) return;
        setMembers(r.members);
        setError(null);
      })
      .catch((e) => {
        if (!settlement.isCurrent({ generation })) return;
        setError(e instanceof Error ? e.message : t("failed to load members"));
      });

  }, [port, settlement, translate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => refresh?.subscribe({ onRefresh: load }), [refresh, load]);

  function stateFor({ id }: { id: string }): RowActionState {
    return rowState[id] ?? emptyRowState({});
  }

  function patchRowState(id: string, patch: Partial<RowActionState>) {
    setRowState((current) => ({ ...current, [id]: { ...emptyRowState({}), ...current[id], ...patch } }));
  }

  async function onDisable(member: AdminMember) {
    if (stateFor({ id: member.id }).disabling) return;
    patchRowState(member.id, { disabling: true, error: null, notice: null });
    try {
      const result = await port.disableMember({ id: member.id });
      setMembers((current) => (current ? current.map((m) => (m.id === member.id ? result.member : m)) : current));
      patchRowState(member.id, { disabling: false, notice: t("Member disabled.") });
    } catch (e) {
      patchRowState(member.id, { disabling: false, error: describeApiError(e, t("Failed to disable member.")) });
    }
  }

  async function onResendSignInLink(member: AdminMember) {
    if (stateFor({ id: member.id }).resending) return;
    patchRowState(member.id, { resending: true, error: null, notice: null });
    try {
      await port.requestMemberMagicLink({ email: member.email });
      patchRowState(member.id, { resending: false, notice: t("Sign-in link sent.") });
    } catch (e) {
      patchRowState(member.id, { resending: false, error: describeApiError(e, t("Failed to send sign-in link.")) });
    }
  }

  async function confirmDisable() {
    if (!confirmingDisable) return;
    await onDisable(confirmingDisable);
    setConfirmingDisable(null);
  }

  async function onToggleDetail(member: AdminMember) {
    if (expandedIdRef.current === member.id) {
      expandedIdRef.current = null;
      setExpandedId(null);
      return;
    }
    expandedIdRef.current = member.id;
    setExpandedId(member.id);
    setDetailError(null);
    if (detailById[member.id]) return;

    setDetailLoadingId(member.id);

    const generation = detailSettlement.next();
    try {
      const result = await port.getMember({ id: member.id });
      setDetailById((current) => ({ ...current, [member.id]: result.member }));
    } catch (e) {

      if (detailSettlement.isCurrent({ generation }) && expandedIdRef.current === member.id) {
        setDetailError(describeApiError(e, t("Failed to load member detail.")));
      }
    } finally {

      if (detailSettlement.isCurrent({ generation })) setDetailLoadingId(null);
    }
  }

  return {
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

    t: boundT,
    translate,
  };
}


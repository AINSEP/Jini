import { createElement, createContext, useContext, useMemo } from 'react';
import type { MembersState, AdminMember } from '../../models.js';
import { createMembersController } from '../../controllers/members.controller.js';
import type { MembersController } from '../../controllers/members.controller.js';
import { hasAdminGrant } from '../../people.rules.js';
import type { MenuItem } from '@jini-ai/ui-kit/react';
import { useMembersScope } from './MembersBinding.hooks.js';
import type { MembersPageProps } from './MembersBinding.hooks.js';
import { usePeopleController } from './PeopleController.hooks.js';
export interface MembersView { controller: MembersController; state: MembersState; canManage: boolean }
export const MembersViewContext = createContext<MembersView | null>(null);
export function useMembersView(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { const v = useContext(MembersViewContext); if (!v) throw new Error('Members controller unavailable.'); return v; }
export function useMembersPage(props: MembersPageProps, _optional: Record<string, never> = {}) {
  const { api, permissions } = useMembersScope({});
  const scope = useMemo(() => ({ api, refresh: props.refresh }), [api, props.refresh]);
  const key = JSON.stringify(permissions);
  const { controller, state } = usePeopleController<MembersState, MembersController>({ scope, key,
    create: () => createMembersController({ api }, { permissions, ...(props.refresh ? { refresh: props.refresh } : {}) }), start: c => { void c.load({}); },
  });
  const canManage = hasAdminGrant({ permissions, permission: 'member.manage' });
  return { content: props.tabs.members ? createElement(props.tabs.members, {}) : null, state, controller, canManage, visible: props.description.visible && props.description.tabs.some(t => t.visible),
    view: state && controller ? { state, controller, canManage } : null, retry: () => { void controller?.load({}); } };
}
export function useMemberRow({ member }: { member: AdminMember }, _optional: Record<string, never> = {}) {
  const { state: s, controller: c, canManage } = useMembersView({}), id = member.id;
  const rs = c.stateFor({ id }), items: MenuItem[] = [];
  if (canManage) {
    items.push({ id: 'resend', label: 'Resend sign-in link', disabled: rs.resending, onPress: () => { void c.resendSignInLink({ id }); } });
    if (member.status !== 'disabled') items.push({ id: 'disable', label: 'Disable', disabled: rs.disabling, onPress: () => c.requestDestructive({ id }) });
  }
  return { s, rs, items, menuLabel: `Actions for member "${member.email}"`, expanded: s.expandedId === id,
    detail: s.detailById[id], loading: s.detailLoadingId === id, toggle: () => { void c.toggleDetail({ id }); },
    verified: s.detailById[id]?.emailVerifiedAt ?? 'not verified', created: member.createdAt, };
}
export function useMembersConfirmation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { state: s, controller: c } = useMembersView({});
  return { open: s.pending !== null, title: 'Disable this member?', body: s.pending ? `Disable "${s.pending.email}"? They will no longer be able to sign in.` : '',
    confirmLabel: 'Disable', tone: 'warning' as const, consequence: 'revokes sign-in access', pending: s.confirming, agentMayConfirm: false,
    onConfirm: async () => { await c.confirmDestructive({}); }, onCancel: () => c.cancelDestructive({}) };
}

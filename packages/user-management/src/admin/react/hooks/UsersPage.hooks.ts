import { createElement, createContext, useContext, useMemo } from 'react';
import { createUsersController } from '../../controllers/users.controller.js';
import type { UsersController } from '../../controllers/users.controller.js';
import type { UsersState } from '../../models.js';
import { hasAdminGrant } from '../../people.rules.js';
import { useUsersScope } from './UsersBinding.hooks.js';
import type { UsersPageProps } from './UsersBinding.hooks.js';
import { usePeopleController } from './PeopleController.hooks.js';
export interface UsersView { controller: UsersController; state: UsersState; permissions: readonly string[] }
export const UsersViewContext = createContext<UsersView | null>(null);
export function useUsersView(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { const v = useContext(UsersViewContext); if (!v) throw new Error('Users controller unavailable.'); return v; }
export function useUsersPage(props: UsersPageProps, _optional: Record<string, never> = {}) {
  const { api, safety, permissions } = useUsersScope({});
  const scope = useMemo(() => ({ api, safety, closed: props.onOwnPasswordResetClosed }), [api, safety, props.onOwnPasswordResetClosed]);
  const key = JSON.stringify([permissions, props.openOwnPasswordReset]);
  const { controller, state } = usePeopleController<UsersState, UsersController>({ scope, key,
    create: () => createUsersController({ api, safety }, { permissions, ...(props.openOwnPasswordReset !== undefined ? { openOwnPasswordReset: props.openOwnPasswordReset } : {}), ...(props.onOwnPasswordResetClosed ? { onOwnPasswordResetClosed: props.onOwnPasswordResetClosed } : {}) }),
    start: c => { void c.load({}); void c.loadCaller({}); },
  });
  const visible = props.description.visible && props.description.tabs.some(t => t.visible);
  return { content: props.tabs.users ? createElement(props.tabs.users, {}) : null, controller, state, visible, view: controller && state ? { controller, state, permissions } : null,
    readOnly: !hasAdminGrant({ permissions, permission: 'user.manage' }) && !hasAdminGrant({ permissions, permission: 'role.manage' }),
    retry: () => { void controller?.load({}); } };
}

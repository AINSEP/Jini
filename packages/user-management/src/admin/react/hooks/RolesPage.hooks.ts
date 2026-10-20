import { createContext, createElement, useContext, useState } from 'react';
import type { RolesPageProps } from './RolesBinding.hooks.js';
import { useRolesController } from './RolesController.hooks.js';
import { canManageRoles, destructiveCopy } from '../../rules.js';
import type { RolesController } from '../../controllers/roles.controller.js';
import type { RolesState } from '../../models.js';
import type { ConfirmDialogProps } from '@jini-ai/ui-kit/react';
export interface RolesView {
    readonly controller: RolesController;
    readonly state: RolesState;
    readonly canManage: boolean;
}
export const RolesViewContext = createContext<RolesView | null>(null);
export function useRolesView(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const view = useContext(RolesViewContext);
    if (!view)
        throw new Error('Roles page controller unavailable.');
    return view;
}
/** A described tab id is namespaced (`roles.roles.policies`); its last segment keys `props.tabs`. */
function tabKey({ id }: { id: string }, _optional: Record<string, never> = {}) {
    return id.slice(id.lastIndexOf('.') + 1);
}
/** Tabs to offer: none on a hidden page, else every visible described tab the host supplied. */
function visibleTabs(props: RolesPageProps, _optional: Record<string, never> = {}) {
    if (!props.description.visible)
        return [];
    return props.description.tabs.filter(t => t.visible && props.tabs[tabKey(t)]).map(t => ({ ...t, key: tabKey(t) }));
}
/** The shell's destructive dialog; before the controller attaches it is closed and inert. */
function rolesConfirm({ controller, state }: { controller: RolesController | null; state: RolesState | null }, _optional: Record<string, never> = {}): ConfirmDialogProps {
    const pending = state?.pending ?? null;
    const copy = destructiveCopy({ target: pending });
    return { open: pending != null, title: copy.title, body: copy.body, confirmLabel: copy.label,
        tone: copy.tone, consequence: copy.consequence, pending: state?.confirming ?? false, agentMayConfirm: false,
        onConfirm: async () => { await controller?.confirmDestructive({}); }, onCancel: () => controller?.cancelDestructive({}) };
}
export function useRolesPage(props: RolesPageProps, _optional: Record<string, never> = {}) {
    const { controller, state, permissions } = useRolesController({});
    const [selected, setSelected] = useState('roles');
    const canManage = canManageRoles({ permissions });
    const visible = visibleTabs(props);
    const ids = visible.map(t => t.key);
    // A stale bookmark opens a real visible tab; omitted/forbidden tabs cannot be rendered directly.
    const requested = props.requestedTab ?? selected;
    const tab = ids.includes(requested) ? requested : ids[0] ?? '';
    const items = visible.map(t => ({ id: t.key, label: t.label, content: t.key === tab ? createElement(props.tabs[t.key]!, { params: t.params }) : null }));
    return {
        controller, state, canManage, items, tab, confirm: rolesConfirm({ controller, state }),
        hidden: !props.description.visible, noTabs: visible.length === 0,
        view: controller && state ? { controller, state, canManage } : null,
        changeTab: ({ value }: {
            value: string;
        }) => { setSelected(value); props.onTabChange?.({ tab: value }); },
        retry: () => { void controller?.load({}); },
    };
}

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
export function useRolesPage(props: RolesPageProps, _optional: Record<string, never> = {}) {
    const { controller, state, permissions } = useRolesController({});
    const [selected, setSelected] = useState('roles');
    const canManage = canManageRoles({ permissions });
    const visible = props.description.visible ? props.description.tabs.filter(t => t.visible && props.tabs[t.id.slice(t.id.lastIndexOf('.') + 1)]) : [];
    const ids = visible.map(t => t.id.slice(t.id.lastIndexOf('.') + 1));
    // A stale bookmark opens a real visible tab; omitted/forbidden tabs cannot be rendered directly.
    const requested = props.requestedTab ?? selected;
    const tab = ids.includes(requested) ? requested : ids[0] ?? '';
    const items = visible.map(t => { const id = t.id.slice(t.id.lastIndexOf('.') + 1), Component = props.tabs[id]!; return { id, label: t.label, content: id === tab ? createElement(Component, { params: t.params }) : null }; });
    const copy = destructiveCopy({ target: state?.pending ?? null });
    const confirm: ConfirmDialogProps = { open: state?.pending != null, title: copy.title, body: copy.body, confirmLabel: copy.label,
        tone: copy.tone, consequence: copy.consequence, pending: state?.confirming ?? false, agentMayConfirm: false,
        onConfirm: async () => { await controller?.confirmDestructive({}); }, onCancel: () => controller?.cancelDestructive({}) };
    return {
        controller, state, canManage, items, tab, confirm,
        hidden: !props.description.visible, noTabs: visible.length === 0,
        view: controller && state ? { controller, state, canManage } : null,
        changeTab: ({ value }: {
            value: string;
        }) => { setSelected(value); props.onTabChange?.({ tab: value }); },
        retry: () => { void controller?.load({}); },
    };
}

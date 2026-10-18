import { useId, useState } from 'react';

/** Structural display port: hosts pass the very same actions used by their quick settings menu. */
export interface ChatSettingsSection {
  /** One-line explanation for a whole radio group; falls back to its first item's hint. */
  key: string; label?: string; description?: string;
  items: readonly { key: string; label: string; role?: string; checked?: boolean; hint?: string; disabled?: boolean; onSelect?: () => void }[];
}
export interface ChatPermissionsPort {
  enabled: boolean; canEdit: boolean; busy?: boolean; error?: string | null; unavailableReason?: string;
  capabilities: readonly { key: string; label: string; description: string; enabled: boolean }[];
  onChange(input: { key?: string; enabled: boolean }): void;
}
export type ChatSettingsTab = 'display' | 'permissions';

/** Modal visibility only; display and permission state remain owned by the injected ports. */
export function useChatSettingsDialog(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const [open, setOpen] = useState(false);
  return { open, show: (_input: Record<string, never> = {}) => setOpen(true), close: (_input: Record<string, never> = {}) => setOpen(false) };
}

/** Bind existing menu actions and a host permission port without local preference copies.
 * The active tab is the only local state: it is view navigation, not a setting.
 * @complexity O(d + c) for the bounded display rows and host capabilities; no I/O here.
 */
export function useChatSettingsView(required: {
  displaySections: readonly ChatSettingsSection[]; permissions: ChatPermissionsPort; t?: (key: string) => string;
}, _optional: Record<string, never> = {}) {
  const t = required.t ?? ((key: string) => key), permissions = required.permissions;
  const id = useId();
  const [tab, setTab] = useState<ChatSettingsTab>('display');
  const disabled = !permissions.canEdit || !!permissions.busy;
  return { t, permissions,
    tab, setTab: (next: string) => setTab(next === 'permissions' ? 'permissions' : 'display'),
    tabs: [{ id: 'display', label: t('Display') }, { id: 'permissions', label: t('Agent permissions') }],
    display: required.displaySections.map(section => ({ ...section,
      radio: section.items[0]?.role === 'menuitemradio',
      name: `${id}-${section.key}`,
      // Radio rows share one line explaining the whole choice, so it sits under the group label.
      hint: section.items[0]?.role === 'menuitemradio' ? section.description ?? section.items[0]?.hint : undefined,
      hintId: `${id}-${section.key}`,
      items: section.items.map(item => ({ ...item, hintId: `${id}-${section.key}-${item.key}`,
        change: () => { if (!item.disabled) item.onSelect?.(); } })),
    })),
    master: { label: t('Full CLI access'), checked: permissions.enabled, disabled, descriptionId: `${id}-master`,
      description: t('Turn every capability below on or off at once.'),
      onCheckedChange: ({ checked }: { checked: boolean }) => { if (!disabled) permissions.onChange({ enabled: checked }); } },
    capabilities: permissions.capabilities.map(item => ({ ...item, descriptionId: `${id}-${item.key}`,
      control: { label: item.label, checked: item.enabled, disabled,
        onCheckedChange: ({ checked }: { checked: boolean }) => { if (!disabled) permissions.onChange({ key: item.key, enabled: checked }); } },
    })),
  };
}

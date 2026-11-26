import type { ComponentType } from "react";
import type { KitChatSettingsSegmentedProps } from "../../react/kit.js";

/**
 * @file The Email page's segmented pill: the host's chat UI control wrapped in the radiogroup the Email tabs share.
 * It stays in the host because `ChatSettingsSegmented` lives in the host's chat UI library; the rest of the shared Email pieces are in
 * `@jini-ai/admin/screens/email/EmailParts`.
 */

/**
 * One section of a tab at a time, picked with the gear menu's segmented pill (owner, 2026-10-22:
 * "reduce the cognitive load" — Overview and Provider stacked every card). Reuses
 * `ChatSettingsSegmented` (real radios sharing `name`, so arrow keys move between segments); the
 * `radiogroup` wrapper names the group. The caller owns the choice (the page keeps it in `?p=`).
 */
export function Segments(props: { name: string; label: string; items: readonly { key: string; label: string }[]; active: string; onSelect: (key: string) => void; kit: { ChatSettingsSegmented: ComponentType<KitChatSettingsSegmentedProps> } }, _optional = {}) {
  const { ChatSettingsSegmented } = props.kit;
  return (
    <div className="email-segments" role="radiogroup" aria-label={props.label}>
      <ChatSettingsSegmented
        name={props.name}
        items={props.items.map((item) => ({ key: item.key, label: item.label, checked: item.key === props.active, change: () => props.onSelect(item.key) }))}
      />
    </div>
  );
}

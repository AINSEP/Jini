import type { ComponentType } from 'react';
import type { EmailSegmentedProps } from './email-view.types.js';

/**
 * @file The mail screen's segmented pill: the host's segmented control (injected as `Segmented`) wrapped
 * in the radiogroup the mail tabs share. Internal to `react/mail`; no package leaf.
 */

/**
 * One section of a tab at a time, picked with a segmented pill (owner, 2026-10-22: "reduce the
 * cognitive load" — stacked cards were too much). The injected `Segmented` renders real radios sharing
 * `name`, so arrow keys move between segments; the `radiogroup` wrapper names the group. The caller owns
 * the choice (the host keeps it in its URL).
 */
export function Segments(props: { name: string; label: string; items: readonly { key: string; label: string }[]; active: string; onSelect: (key: string) => void; Segmented: ComponentType<EmailSegmentedProps> }) {
  return (
    <div className="email-segments" role="radiogroup" aria-label={props.label}>
      <props.Segmented
        name={props.name}
        items={props.items.map((item) => ({ key: item.key, label: item.label, checked: item.key === props.active, change: () => props.onSelect(item.key) }))}
      />
    </div>
  );
}

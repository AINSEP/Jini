import type { ReactNode } from "react";

export interface ComingSoonPanelProps {
  /** Terse status without promised dates; label plus optional note should occupy at most two lines. */
  label: string;
  note?: string | undefined;
  children: ReactNode;
}

// Keep the real content visible so operators can see what is coming; an empty placeholder
// would hide that context. Native inert removes the subtree from tab order, click handling and
// the accessibility tree: opacity or pointer-events alone leaves apparently disabled controls usable.
// The existing inert-control style uses 0.55 opacity to signal inactivity while retaining legibility.
/** Keeps preview content mounted inside an inert subtree, with caller-supplied status copy. */
export function ComingSoonPanel({ label, note, children }: ComingSoonPanelProps) {
  return (
    <div className="coming-soon-panel">
      <p className="settings-ui-inert-note" role="note">
        <strong>{label}</strong>
        {note ? <> {note}</> : null}
      </p>
      {}
      <div className="settings-ui-inert-control" inert>
        {children}
      </div>
    </div>
  );
}

/**
 * @module NextStepActions
 *
 * A generic row of "what next" suggestion buttons rendered after a
 * completed assistant turn. Heavily pruned from OD's
 * `components/NextStepActions.tsx` (1,069 lines) per
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §1's explicit directive for
 * this file ("prune OD actions"): the OD original hardcodes ~20 product-
 * specific prompt catalogs (design-system refine/audit, brand-extraction
 * continue/AI-optimize, plan-generate-from-doc, project-continue, ...), a
 * design-toolbox action registry, and PostHog click tracking. None of that
 * is generic — every OD prompt catalog is a host concern now: a host
 * supplies its own `NextStepAction[]` (e.g. OD's adapter in
 * `foundry/integrations/open-design/` re-hosts its exact prompt catalogs against
 * this same component). className/structure kept close to the original's
 * action-row shape; every user-facing string wrapped in `useT()`.
 */
import type { ReactNode } from 'react';
import { useT } from '../hooks/context.js';

export interface NextStepAction {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Disables the action and swaps its label for `busyLabel` while a host-tracked operation for this action is in flight. */
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
}

export interface NextStepActionsProps {
  actions: NextStepAction[];
  onSelect: (actionId: string) => void;
}

export function NextStepActions({ actions, onSelect }: NextStepActionsProps) {
  const t = useT();
  if (actions.length === 0) return null;
  return (
    <div className="next-step-actions">
      {actions.map((action) => (
        <button key={action.id} type="button" className="next-step-action" disabled={action.disabled || action.busy} onClick={() => onSelect(action.id)}>
          {action.icon ? (
            <span className="next-step-action-icon" aria-hidden>
              {action.icon}
            </span>
          ) : null}
          <span className="next-step-action-body">
            <span className="next-step-action-title">{action.busy && action.busyLabel ? t(action.busyLabel) : t(action.label)}</span>
            {action.description ? <span className="next-step-action-desc">{t(action.description)}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

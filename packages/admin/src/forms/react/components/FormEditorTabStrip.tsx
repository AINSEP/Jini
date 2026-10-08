import { useFormTabStripView } from "../hooks/forms-view.hooks.js";
import type * as React from 'react';
import { agentHandle } from '@jini-ai/agentic';

export function FormEditorTabStrip(props: {
  showTabs: boolean;
  tab: "fields" | "submissions";
  onTabChange: (tab: "fields" | "submissions") => void;
  tabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  onTabsKeyDown: (e: React.KeyboardEvent) => void;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
}, _optional: Record<string, never> = {}) {
  const { showTabs, tab, onTabChange, tabRefs, onTabsKeyDown, t } = props;
  const tabs = useFormTabStripView({ onTabChange, tabRefs });
  if (!showTabs) return null;

  return (
    <div className="form-tabs" role="tablist" aria-label={t("Form sections")} onKeyDown={onTabsKeyDown}>
      {tabs.map((formTab) => (
        <button
          key={formTab.id}
          ref={formTab.ref}
          type="button"
          role="tab"
          id={`form-tab-${formTab.id}`}
          className="form-tab"
          aria-selected={tab === formTab.id}
          aria-controls={`form-panel-${formTab.id}`}
          tabIndex={tab === formTab.id ? 0 : -1}
          onClick={formTab.onClick}
          {...agentHandle({ handle: `form-tab-${formTab.id}` }, {
            role: "button",
            label: formTab.id === "fields" ? "Switch to this form's Fields tab" : "Switch to this form's Submissions tab",
          })}
        >
          {t(formTab.label)}
        </button>
      ))}
    </div>
  );
}

/** Which card is showing below the tab strip: the fields form (always for `isNew`, or when the
 * Fields tab is active) or the submissions table. */

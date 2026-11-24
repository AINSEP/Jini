import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { KeyboardEvent } from "react";
import type { AdminMenuMode } from "./api/menus-api.types.js";

/**
 * @file The menu editor's "Options" | "HTML" tablist. The arrow/Home/End keys and roving tab stop
 * come from the host's tab-strip helpers, which reach it as the REQUIRED {@link MenuTabStrip} prop
 * (`@jini-ai/ui/tab-strip` is not an edge `@jini-ai/admin` may take).
 */

interface TabLike { id: string; label: string; disabled?: boolean }

/** The tab-strip helpers the mode tabs need — the host passes `@jini-ai/ui/tab-strip`'s. */
export interface MenuTabStrip {
  useTabBarKeyboard: (required: { tabs: readonly TabLike[]; activeId: string; onChange: (id: string) => void }, optional?: Record<string, never>) => { onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void };
  resolveTabBarTabIndex: (required: { tabs: readonly TabLike[]; activeId: string; tab: TabLike }, optional?: Record<string, never>) => 0 | -1;
}

/** The "Options" | "HTML" tabs, keyed by the {@link AdminMenuMode} each one saves. `id` is what the
 *  tab-strip keyboard helpers key on — the same `.segmented` tablist PageEditor uses. */
const MODE_TABS: ReadonlyArray<{ id: AdminMenuMode; label: string }> = [{ id: "items", label: "Options" }, { id: "html", label: "HTML" }];

/**
 * The authoring-mode tablist — PageEditor's `.page-editor-toolbar` > `.segmented role=tablist` row,
 * with the shared arrow/Home/End keys and roving tab stop from `useTabBarKeyboard`.
 */
export function MenuModeTabs({ mode, onChange, t, tabStrip }: { mode: AdminMenuMode; onChange: (mode: AdminMenuMode) => void; t: Translate; tabStrip: MenuTabStrip }) {
  const { onKeyDown } = tabStrip.useTabBarKeyboard({ tabs: MODE_TABS, activeId: mode, onChange: (id) => onChange(id as AdminMenuMode) });
  return (
    <div className="jini-page-editor-toolbar">
      <div className="jini-segmented" role="tablist" aria-label={t("Menu editor mode")} onKeyDown={onKeyDown}>
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            className={mode === tab.id ? "jini-is-active" : undefined}
            tabIndex={tabStrip.resolveTabBarTabIndex({ tabs: MODE_TABS, activeId: mode, tab })}
            onClick={() => onChange(tab.id)}
            {...agentHandle({ handle: `menu-mode-${tab.id}` }, { role: "button", label: `Switch to the ${tab.label} tab` })}
          >
            {/* Literal keys, not `t(tab.label)`: the host's i18n parity test resolves every key statically. */}
            {t(tab.id === "html" ? "HTML" : "Options")}
          </button>
        ))}
      </div>
    </div>
  );
}

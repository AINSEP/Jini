import { useId } from "react";
import { t } from "./webmcp-i18n.js";

/** The host's browser-agent preference hook (e.g. a `useBrowserAgentSettings` that owns the
 *  origin-local storage key and its storage events) — injected so this panel never reaches storage. */
export type UseBrowserAgentSettingsHook = (required: Record<string, never>) => {
  enabled: boolean;
  setEnabled: (required: { enabled: boolean }) => void;
};

/** Same `jini-toggle-row` switch the Privacy tab's own toggles use, so the host CSS styles it. */
export function BrowserAgentSettingsPanel({ locale, useBrowserAgentSettingsHook }: { locale: string; useBrowserAgentSettingsHook: UseBrowserAgentSettingsHook; }) {
  const { enabled, setEnabled } = useBrowserAgentSettingsHook({});
  const id = useId();
  return (
    <section className="jini-settings-section">
      <div className="jini-settings-privacy-toggles">
        {/* Human-only: an agent must not be able to enable its own access. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={enabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          className={enabled ? "jini-toggle-row on" : "jini-toggle-row"}
          onClick={() => setEnabled({ enabled: !enabled })}
        >
          <span className="jini-toggle-row-text">
            <span id={`${id}-label`} className="jini-toggle-row-label">{t({ locale: locale, key: "Browser-agent access (WebMCP)" })}</span>
            <span id={`${id}-hint`} className="jini-toggle-row-hint">
              {t({ locale: locale, key: "Enabled by default. This choice applies to the admin in this browser on this site." })}
              {" "}
              {t({ locale: locale, key: "Compatible browsers can operate tagged admin controls. Destructive and publish actions require approval." })}
            </span>
          </span>
          <span className="jini-toggle-row-switch" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

import { useId, type ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { PublicAssistantSettings } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import type { InfoTipProps } from "../../react/kit.js";
import { AssistantToggleRow } from "./AssistantToggleRow.js";
import type { SetVisitorWidget, useVisitorAssistantPanel } from "./use-visitor-assistant-panel.hooks.js";
import type { VisitorCredentialFormController } from "./visitor-credential-form-port.js";

/** Bind the visitor panel's translated information label. */
export function createVisitorMoreInfo({ t }: { t: (key: string) => string }, _options = {}) {
  return (name: string) => t("More info: {name}").replace("{name}", () => name);
}

/**
 * The Visitor tab (2026-10-09 redesign): a status pill, then three numbered steps in the order an
 * operator actually does them — connect a provider, pick the widget, turn it on. The switch comes
 * LAST and stays disabled until a key is saved, because an assistant switched on with no key is
 * mounted on every public page and cannot answer.
 *
 * Every explanation that used to sit inline as a paragraph is an ⓘ tip now; none was dropped.
 *
 * The credential controller is created HERE, once, and handed to the form, so the pill and the
 * switch gate read the same `hasStoredKey` the form's own save line does. `CredentialForm` is
 * injected (the host's own form markup) to avoid an import cycle.
 */
export interface VisitorAssistantPanelProps {
  controller: {
    settings: PublicAssistantSettings;
    saving: boolean;
    saveError: string | null;
    setPublicEnabled: (required: { publicEnabled: boolean }, optional?: Record<string, never>) => Promise<void>;
    setWidget: SetVisitorWidget;
  };
  CredentialForm: ComponentType<{ useVisitorCredentialFormHook: () => VisitorCredentialFormController; t: (key: string) => string }>;
  t: (key: string) => string;
  /** The host's ⓘ widget. */
  InfoTip: ComponentType<InfoTipProps>;
  /** The host's wired credential-form hook (its client, rules and provider catalog). */
  useVisitorCredentialFormHook: () => VisitorCredentialFormController;
  useVisitorAssistantPanelHook: typeof useVisitorAssistantPanel;
}

export function VisitorAssistantPanel(props: VisitorAssistantPanelProps) {
  const { controller, CredentialForm, t, InfoTip } = props;
  const { settings, saving, saveError, setPublicEnabled, setWidget } = controller;
  // Called through `props` because the host's hooks are required props, never defaults.
  const credential = props.useVisitorCredentialFormHook();
  const panel = props.useVisitorAssistantPanelHook({ settings, hasStoredKey: credential.hasStoredKey, setWidget });
  const widgetId = useId();
  const reasonId = useId();
  const moreInfo = createVisitorMoreInfo({ t });

  if (credential.loadState.status === "loading") return <p role="status">{t("Loading saved settings…")}</p>;
  if (credential.loadState.status === "error") return <p role="alert">{t(credential.loadState.message)}</p>;

  return (
    <div className="jini-visitor-assistant">
      {saveError ? <div className="jini-save-error">{saveError}</div> : null}

      <p className="jini-visitor-status" role="status">
        <span className="jini-visitor-status-caption">{t("Public site")}</span>
        <span className={`jini-visitor-pill jini-visitor-pill--${panel.status}`}>{t(panel.statusCopy.label)}</span>
        <span className="jini-visitor-status-hint">{t(panel.statusCopy.hint)}</span>
      </p>

      <ol className="jini-visitor-steps">
        <li className="jini-visitor-step">
          <div className="jini-visitor-step-head">
            <h3 className="jini-visitor-step-title">{t("Connect an AI provider")}</h3>
            {/* One plain sentence (owner, 2026-10-09: "the tool tips are confusing"). The old tip
                explained how this key differs from the admin's own BYOK key; that comparison now
                lives only on the Admin tab, where the BYOK key actually is. */}
            <InfoTip
              label={t("For visitors who want to talk to your site with AI.")}
              triggerLabel={t("About the visitor key")}
              agentHandle="ai-assistant-visitor-key-info"
            />
          </div>
          <p className="jini-visitor-step-hint">{t("This key is for your visitors, not for you.")}</p>
          <CredentialForm useVisitorCredentialFormHook={() => credential} t={t} />
        </li>

        <li className="jini-visitor-step">
          <div className="jini-visitor-step-head">
            <h3 className="jini-visitor-step-title"><label htmlFor={widgetId}>{t("Widget")}</label></h3>
            <InfoTip
              label={t("React is the full widget. Pure JS is smaller and loads faster.")}
              triggerLabel={moreInfo(t("Widget"))}
              agentHandle="ai-assistant-visitor-widget-info"
            />
            <select id={widgetId} className="jini-input jini-visitor-compact-select" value={panel.widget} disabled={saving}
              onChange={(event) => panel.chooseWidget({ value: event.target.value })}
              {...agentHandle({ handle: "ai-assistant-visitor-widget" }, { role: "field", label: "Visitor chat widget" })}>
              {/* Labels name the build and its gzipped size; the stored values stay "react"/"vanilla".
                  "beta" was dropped: nothing in code marks the vanilla build as beta any more.
                  Sizes measured 2026-10-09 with gzip -9 on the host's site-chat build: site-assistant.js
                  209,573 B, site-assistant-vanilla.js 36,031 B. Re-measure when either build moves. */}
              <option value="react">React (~210 KB)</option>
              <option value="vanilla">{t("Pure JS")} (~35 KB)</option>
            </select>
          </div>
        </li>

        <li className="jini-visitor-step">
          <div className="jini-visitor-step-head">
            <h3 className="jini-visitor-step-title">{t("Turn it on")}</h3>
          </div>
          <AssistantToggleRow t={t} InfoTip={InfoTip} variant="switch" label={t("Enable the AI assistant on the public site")}
            info={t(panel.enableInfo)} checked={settings.publicEnabled}
            disabled={saving || !panel.canEnable} onChange={(checked) => void setPublicEnabled({ publicEnabled: checked })}
            describedBy={panel.enableBlockedReason ? reasonId : undefined}
            inputProps={agentHandle({ handle: "ai-assistant-visitor-enable" }, { role: "field", label: "Enable the AI assistant on the public site" })}
            infoHandle="ai-assistant-visitor-enable-info">
            {panel.enableBlockedReason ? <p id={reasonId} className="jini-visitor-step-hint">{t(panel.enableBlockedReason)}</p> : null}
          </AssistantToggleRow>
        </li>
      </ol>
    </div>
  );
}

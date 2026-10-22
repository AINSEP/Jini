import type { CommentsTranslator } from '../../messages.en.js';
import { agentHandle } from '@jini-ai/agentic';
import { useWiredCommentSettings } from '../hooks/use-comment-settings.hooks.js';
import { useSettingsSection } from '../hooks/SettingsSection.hooks.js';

export interface SettingsSectionProps {
  canConfigure: boolean;
  t?: CommentsTranslator;
  /** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the real hook, so production callers (the exported
   *  `Comments` below) pass nothing and behave exactly as before. */
  useCommentSettingsHook?: typeof useWiredCommentSettings;
}

/** Exported (2026-08-14, previously module-private) so `SettingsSection.unit.test.tsx` can drive
 *  its own DI seam directly — see `QueueSection`'s identical doc comment above. */
export function SettingsSection(props: SettingsSectionProps) {
  const { settings, error, saving, notice, onSubmit, t } = useSettingsSection(props);

  if (!props.canConfigure) return null;

  if (error && !settings) return <div className="notice error">{error}</div>;
  if (!settings) return <div className="notice">{t("Loading Comments settings…")}</div>;

  return (
    <div>
      <h2>{t("Settings")}</h2>
      {error ? <div className="notice error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <form
        className="card"
        onSubmit={onSubmit}
      >
        <div className="field-group">
          <label className="form-checkbox-field">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.enabled}
              {...agentHandle({ handle: "comments-settings-enabled" }, { role: "field", label: "Whether comments are enabled at all" })}
            />
            {t("Comments enabled")}
          </label>
          <label className="form-checkbox-field">
            <input
              type="checkbox"
              name="requireModeration"
              defaultChecked={settings.requireModeration}
              {...agentHandle({ handle: "comments-settings-require-moderation" }, {
                role: "field",
                label: "Whether new comments start pending moderation",
              })}
            />
            {t("Require moderation (new comments start pending)")}
          </label>
        </div>

        <div className="field-group">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="comments-max-depth">
                {t("Max thread depth")}
              </label>
              <input
                id="comments-max-depth"
                type="number"
                name="maxDepth"
                min={0}
                step={1}
                defaultValue={settings.maxDepth}
                {...agentHandle({ handle: "comments-settings-max-depth" }, { role: "field", label: "Maximum comment thread depth" })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="comments-close-after-days">
                {t("Close submissions after (days, blank = never)")}
              </label>
              <input
                id="comments-close-after-days"
                type="number"
                name="closeAfterDays"
                min={0}
                step={1}
                defaultValue={settings.closeAfterDays ?? ""}
                {...agentHandle({ handle: "comments-settings-close-after-days" }, {
                  role: "field",
                  label: "Days after which submissions close, blank for never",
                })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="comments-spam-score">
                {t("Spam auto-reject score (0–1)")}
              </label>
              <input
                id="comments-spam-score"
                type="number"
                name="spamAutoRejectScore"
                min={0}
                max={1}
                step={0.01}
                defaultValue={settings.spamAutoRejectScore}
                {...agentHandle({ handle: "comments-settings-spam-score" }, { role: "field", label: "Spam auto-reject score, 0 to 1" })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="comments-max-per-ip">
                {t("Max submissions per IP per hour")}
              </label>
              <input
                id="comments-max-per-ip"
                type="number"
                name="maxPerIpPerHour"
                min={1}
                step={1}
                defaultValue={settings.maxPerIpPerHour}
                {...agentHandle({ handle: "comments-settings-max-per-ip" }, { role: "field", label: "Maximum submissions per IP per hour" })}
              />
            </div>
          </div>
        </div>

        <div className="editor-actions form-actions">
          <button
            type="submit"
            disabled={saving}
            {...agentHandle({ handle: "comments-settings-save" }, { role: "button", label: "Save the comments settings" })}
          >
            {saving ? t("Saving…") : t("Save settings")}
          </button>
        </div>
      </form>
    </div>
  );
}


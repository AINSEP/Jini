import type { CommentsTranslator } from '../../messages.en.js';
import { agentHandle } from '@jini-ai/core/agent-handles';
import { CommentsLimitFields, CommentsSwitchFields } from './SettingsFields.js';
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
export function SettingsSection({ useSettingsSectionHook = useSettingsSection, ...props }: SettingsSectionProps & { useSettingsSectionHook?: typeof useSettingsSection }) {
  const { settings, error, saving, notice, onSubmit, t } = useSettingsSectionHook(props);

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
        <CommentsSwitchFields settings={settings} t={t} />

        <CommentsLimitFields settings={settings} t={t} />

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


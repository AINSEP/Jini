import type { CommentsSettings } from '../../../core/ports/comments.js';
import type { CommentsTranslator } from '../../messages.en.js';
import { agentHandle } from '@jini-ai/core/agent-handles';

/** The two on/off switches of the comments settings form. */
export function CommentsSwitchFields({ settings, t }: { settings: CommentsSettings; t: CommentsTranslator }, _optional: Record<string, never> = {}) {
  return (
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
  );
}

/** The four numeric limits of the comments settings form. */
export function CommentsLimitFields({ settings, t }: { settings: CommentsSettings; t: CommentsTranslator }, _optional: Record<string, never> = {}) {
  return (
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
  );
}

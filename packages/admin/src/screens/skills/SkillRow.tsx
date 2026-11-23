import { Icon } from "../../react/kit.js";
import type { SkillRowView, SkillsScreenComponents } from "./skills-screen.types.js";
import { SkillChevronIcon } from "./skills-visuals.js";
import { EyeIcon, TrashIcon } from "../plugins/agent-plugins-visuals.js";

import { type Translate } from '@jini-ai/core/text';
/** Same summary, metadata, switch and action zones as AgentPluginRow. */
export function SkillRow({ row, t = key => key, PlainTextBlocks }: { row: SkillRowView; t?: Translate; PlainTextBlocks: SkillsScreenComponents<object>["PlainTextBlocks"] }) {
  const { skill } = row;
  return (
    <li className="agent-plugin-row" data-enabled={skill.enabled} aria-label={skill.name}>
      <div className="agent-plugin-row-main">
        <div className="jini-skills-row-summary">
          <div className="jini-skills-row-identity">
            <button type="button" className="agent-plugin-row-summary" aria-label={skill.name} onClick={row.onInspect}>
              <span className="agent-plugin-row-glyph"><Icon name="document-marked" size={18} strokeWidth={1.5} /></span>
              <span className="agent-plugin-row-text">
                <span className="agent-plugin-row-heading"><span className="agent-plugin-row-name">{skill.name}</span></span>
                <span className="agent-plugin-row-desc" title={skill.description}>{skill.description}</span>
              </span>
            </button>
            <button type="button" className="agent-plugin-icon-btn jini-skills-row-expander" aria-label={t("Show or hide details — {name}").replace("{name}", () => skill.name)} aria-expanded={row.expanded} aria-controls={row.detailId} onClick={row.onToggleExpanded}>
              <SkillChevronIcon />
            </button>
          </div>
          <p className="jini-skills-row-source">
            {row.sourceUrl ? <><a href={row.sourceUrl} target="_blank" rel="noreferrer">GitHub</a><span aria-hidden="true"> · </span><code>{row.shortCommit}</code></> : t("Uploaded")}
          </p>
        </div>
        <div className="agent-plugin-row-actions">
          <span className="agent-plugin-state">{t(skill.enabled ? "Enabled" : "Disabled")}</span>
          <button type="button" role="switch" aria-checked={skill.enabled} aria-label={t("Enable {name}").replace("{name}", () => skill.name)} aria-busy={row.busy} disabled={row.busy} className="agent-plugin-switch" onClick={row.onToggleEnabled}>
            <span className="agent-plugin-switch-knob" aria-hidden="true" />
          </button>
          <button type="button" className="agent-plugin-icon-btn" aria-label={t("Inspect skill files — {name}").replace("{name}", () => skill.name)} onClick={row.onInspect}><EyeIcon /></button>
          <button type="button" className="agent-plugin-icon-btn" disabled={row.busy} aria-label={t("Remove {name}").replace("{name}", () => skill.name)} onClick={row.onRemove}><TrashIcon /></button>
        </div>
      </div>
      <div className="agent-plugin-row-detail" id={row.detailId} hidden={!row.expanded}>
        <PlainTextBlocks text={skill.description} className="agent-plugin-detail-description" />
      </div>
    </li>
  );
}

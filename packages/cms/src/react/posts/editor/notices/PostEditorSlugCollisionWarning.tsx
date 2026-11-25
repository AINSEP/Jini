import type { AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";

type AgentAttrs = (
  required: { handle: string },
  optional?: AgentHandleOptions,
) => AgentHandleProps;

/**
 * Slug-collision override, tri-state (2026-08-10, tri-state default flip 2026-08-15) — surfaced live
 * 2026-08-10: a post at slug "about" was silently unreachable because the active theme ships its own
 * pages/about.html at the same slug. Warn explicitly rather than let an author discover this by
 * visiting the public URL.
 *
 * As of 2026-08-15 the DEFAULT winner flipped to the post (previously the theme page), and the
 * stored flag became tri-state (`AdminPost.overridesThemePage: boolean | null` — see that field's
 * own doc, `lib/api.ts`) so a two-state checkbox can no longer represent every state: `null` ("never
 * decided", the default applies), `true` (explicitly always this post — same outcome as the default
 * today, but pinned regardless of future default changes), `false` (explicitly always the theme's
 * page). A `<select>` is the smallest control that can express three mutually-exclusive states
 * without inventing a custom widget.
 *
 * Extracted out of `PostEditor` (complexity-ceiling pass, 2026-08-20) — this block was the other
 * major source of that component's own branching (whether to render at all, then the tri-state
 * value/onChange mapping nested inside), same "top-level function scores its own branches
 * independently" reasoning `PostEditorToolbarEnd` above states. `overridesThemePageFromSelectValue`
 * (`rules.ts`) is the onChange half of the tri-state mapping, pulled out as a pure function so it has
 * exactly one implementation shared with that function's own test fixture — see its doc.
 */
export function PostEditorSlugCollisionWarning({
  hasSlugCollision,
  overridesThemePage,
  setOverridesThemePage,
  t,
  agentHandle,
  overridesThemePageSelectValue,
  overridesThemePageFromSelectValue,
  copy,
}: {
  hasSlugCollision: boolean;
  overridesThemePage: boolean | null;
  setOverridesThemePage: (overridesThemePage: boolean | null) => void;
  t: Translate;
  agentHandle: AgentAttrs;
  overridesThemePageSelectValue: (required: { overridesThemePage: boolean | null }, optional?: Record<string, never>) => "default" | "post" | "theme";
  overridesThemePageFromSelectValue: (required: { value: string }, optional?: Record<string, never>) => boolean | null;
  copy: { warning: string; field: string; defaultOption: string; postOption: string; themeOption: string; regionAgentLabel: string; fieldAgentLabel: string };
}) {
  if (!hasSlugCollision) return null;
  return (
    <div
      className="notice warning"
      {...agentHandle({ handle: "post-slug-collision-warning" }, {
        role: "region",
        label: copy.regionAgentLabel,
      })}
    >
      <p>
        {t(copy.warning)}
      </p>
      <label>
        {t(copy.field)}
        {" "}
        <select
          value={overridesThemePageSelectValue({ overridesThemePage: overridesThemePage })}
          // Only "default" maps to `null`; both other options are an explicit, permanent choice
          // (`true`/`false`) that keeps winning even if the default policy changes later — see this
          // control's own file-header doc for the tri-state contract.
          onChange={(e) => setOverridesThemePage(overridesThemePageFromSelectValue({ value: e.target.value }))}
          {...agentHandle({ handle: "post-override-theme-page" }, {
            role: "field",
            label:
              copy.fieldAgentLabel,
          })}
        >
          <option value="default">{t(copy.defaultOption)}</option>
          <option value="post">{t(copy.postOption)}</option>
          <option value="theme">{t(copy.themeOption)}</option>
        </select>
      </label>
    </div>
  );
}

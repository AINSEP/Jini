import { type ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";

/** Props the host's view-template button receives — the icon-only "view this template's source"
 *  control the host shares between its post and page editors. */
export interface PostEditorViewTemplateButtonProps {
  disabled: boolean;
  onClick: () => void;
  t: Translate;
  agentHandleId: string;
}

/**
 * The post-template picker in the toolbar's right-hand group (`PostEditorToolbarEnd` above renders
 * it after the device-width toggle).
 *
 * Extracted out of `PostEditor` (complexity-ceiling pass, 2026-08-20) because this is where most of
 * that component's remaining branching lived once `PostEditorHeader` had already absorbed the header
 * row: the `bodyFormat`-eligibility check, and the has-templates check nested inside it. As a
 * top-level function its own branches are scored in their own scope instead of accumulating onto
 * `PostEditor`'s — same split `PageEditorToolbarEnd` already uses.
 *
 * The view-template button is the host's own component (shared with its page editor's picker), so it
 * arrives as the required `ViewTemplateButton` prop.
 *
 * Post-template-picker feature (2026-08-10) — rendered whenever this is a Post/formulaic-body record
 * (`bodyFormat: "doc"`), not an `"html"`-format Page — a Page's body IS its own design already (see
 * `resolveHtmlEmbedsForRender`'s own doc), so it has nothing to pick between. Its copy shipped
 * Spanish-only at first; every locale in `posts-i18n.ts` carries it since 2026-10-04, when the
 * select also gained `aria-label` (its old `<label>` wrapped only its own hidden text, never the
 * `<select>`, so the control had no accessible name).
 *
 * Options list real templates FIRST, "No template chosen" LAST (owner's own ordering request) —
 * matches `theme.json`'s own `postTemplate` doc ("ordered to nudge the right choice"): opting OUT is
 * the one deliberate action, not the default you land on. The SELECTED value defaults to the first
 * template too when nothing has been chosen yet (see the load effect in `use-post-editor.hooks.ts`)
 * — an author only ever sees "No template chosen" selected if they (or a prior save) explicitly
 * picked it.
 *
 * When the active theme declares zero templates, the row previously vanished entirely (owner
 * feedback, 2026-08-09: "it makes sense... but it should still be there" — an empty theme should
 * read as "nothing to choose" in the UI, not disappear as if the feature itself weren't there).
 * Renders a disabled control with a one-line explanation instead.
 *
 * Rendered regardless of `view` — same as Pages' own picker — because the template choice is a
 * publish-time setting, not something specific to either tab.
 */
export function PostEditorTemplatePicker({
  bodyFormat,
  availableTemplates,
  templateChoice,
  setTemplateChoice,
  onViewTemplateClick,
  ViewTemplateButton,
  t,
}: {
  bodyFormat: "doc" | "html" | undefined;
  availableTemplates: string[];
  templateChoice: string | null;
  setTemplateChoice: (templateChoice: string) => void;
  onViewTemplateClick: () => void;
  ViewTemplateButton: ComponentType<PostEditorViewTemplateButtonProps>;
  t: Translate;
}) {
  if ((bodyFormat ?? "doc") !== "doc") return null;
  return (
    <div className="jini-editor-template-picker">
      {availableTemplates.length > 0 ? (
        <>
          {/* Read-only inspection, not editing (`TemplateSourceModal.tsx`'s own file header —
              "I just wanna see it" is the owner's own framing). Disabled rather than hidden
              when nothing is chosen: an operator who opted out via "No template chosen" (`""`)
              still sees the control, just inert, matching this screen's own precedent for the
              theme-with-zero-templates `<select>` below rather than the row disappearing.
              `ViewTemplateButton` (the host's, shared with its page editor's own template picker)
              owns the icon-only markup and its `aria-label`/`title` — this call site only supplies
              what differs per editor. */}
          <ViewTemplateButton
            disabled={!templateChoice}
            onClick={onViewTemplateClick}
            t={t}
            agentHandleId="post-view-template"
          />
          <select
            value={templateChoice ?? ""}
            aria-label={t("Template")}
            // `e.target.value`, NOT `|| null` — "No template chosen" must persist as `""`
            // (explicitly opted out), which `resolveTemplate` treats differently from `null`
            // (never chosen → falls back to the first template). Coercing to `null` here is what
            // made the two indistinguishable and served 15 posts a diagnostic page.
            onChange={(e) => setTemplateChoice(e.target.value)}
            {...agentHandle({ handle: "post-template-choice" }, {
              role: "field",
              label:
                "Which theme page template this post renders through on the public site. " +
                "Setting this to \"No template chosen\" shows a diagnostic page instead of the post, " +
                "not a silent fallback to generic rendering.",
            })}
          >
            {availableTemplates.map((template) => (
              <option key={template} value={template}>
                {template}
              </option>
            ))}
            <option value="">{t("No template chosen")}</option>
          </select>
        </>
      ) : (
        <select
          disabled
          value=""
          aria-label={t("Template")}
          {...agentHandle({ handle: "post-template-choice" }, {
            role: "field",
            label: "The active theme declares no post templates, so there is nothing to choose here.",
          })}
        >
          <option value="">{t("No templates for this theme")}</option>
        </select>
      )}
    </div>
  );
}

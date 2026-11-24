import { useId, type ComponentType } from "react";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file "Content for this spot" — the per-placement override choice inside a `widgetEmbed` node's
 * Style dialog (the host's widget-embed node extension). "Custom for this post" reuses the same
 * content editor the widget editor page uses: one editor component, two hosts. State is the
 * caller's (the host node view's `placementContent`); this file is markup only. The host passes
 * its editor as `ContentEditor` and imports the editor's stylesheet at the mount.
 */

/** Structural slice of the host's media content editor props this file passes. */
export interface PlacementContentEditorProps {
  widgetType: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  t: Translate;
}

export interface PlacementContentFieldsProps {
  widgetType: string;
  custom: boolean;
  content: Record<string, unknown>;
  setCustom: (custom: boolean) => void;
  setContent: (content: Record<string, unknown>) => void;
  /** The host's shared content editor, shown for "Custom for this post". */
  ContentEditor: ComponentType<PlacementContentEditorProps>;
  t?: Translate;
}

export function PlacementContentFields({ widgetType, custom, content, setCustom, setContent, ContentEditor, t = (key) => key }: PlacementContentFieldsProps) {
  const name = useId();
  return (
    <>
      <fieldset className="jini-widget-embed-content-choice">
        <legend className="jini-field-label">{t("Content for this spot")}</legend>
        <label>
          <input type="radio" name={name} checked={!custom} onChange={() => setCustom(false)} />
          {t("Use the widget's content")}
        </label>
        <label>
          <input type="radio" name={name} checked={custom} onChange={() => setCustom(true)} />
          {t("Custom for this post")}
        </label>
      </fieldset>
      {custom ? <ContentEditor widgetType={widgetType} config={content} onChange={setContent} t={t} /> : null}
    </>
  );
}

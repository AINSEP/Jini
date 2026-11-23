import { agentHandle } from "@jini-ai/core/agent-handles";
import { Dialog } from "@jini-ai/ui-kit/react";
import { resolveTabBarTabIndex, type useTabBarKeyboard } from "@jini-ai/ui/tab-strip";

import type { PostSettingsDialogController, PostSettingsTab } from "./hooks/use-post-editor-ui.hooks.js";
import { PostAuthorFields } from "./PostAuthorFields.js";
import { PostPublishAtField, type PostPublishAtFieldProps } from "./PostPublishingFields.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The post settings modal behind the gear in the action row (owner, 2026-10-10): Author and
 * Publish tabs holding the byline and publish-time controls that used to sit as two rows on the
 * page. Props and JSX only; open state lives in `usePostSettingsDialog`, the field values in
 * `usePostEditor`, so nothing here is saved until the editor's own Save.
 *
 * There was an Image tab too (featured image + "Hide the cover image in the body"); it was removed
 * (owner, 2026-10-11) because the cover slot above the title (`PostCoverImage.tsx`) edits the same
 * `featuredMediaId` and now carries that toggle.
 *
 * Wiring: the host binds the tab strip's keyboard hook into the required `hooks.useTabBarKeyboard`
 * and loads its shared domain-dialog stylesheet wherever it renders this dialog. Only `jini-*`
 * classes are emitted (`jini-post-dialog` shell, `jini-post-settings-tabs` strip whose active tab is
 * the `aria-selected="true"` one, `jini-post-settings-dialog__footer`/`__actions` row); the host
 * styles them, twinning its own dialog/segmented/footer chrome.
 */

const TABS: ReadonlyArray<{ id: PostSettingsTab; label: string }> = [
  { id: "author", label: "Author" },
  { id: "publish", label: "Publish" },
];

export interface PostSettingsDialogProps extends Omit<PostPublishAtFieldProps, "t" | "agentHandle"> {
  hooks: { useTabBarKeyboard: typeof useTabBarKeyboard };
  dialog: PostSettingsDialogController;
  kindLabel: "post" | "page";
  author: string;
  setAuthor: (value: string) => void;
  showAuthor: boolean;
  setShowAuthor: (value: boolean) => void;
  t: Translate;
}

export function PostSettingsDialog({ dialog, kindLabel, author, setAuthor, showAuthor, setShowAuthor, t, hooks, ...publishing }: PostSettingsDialogProps) {
  const { onKeyDown } = hooks.useTabBarKeyboard({ tabs: TABS, activeId: dialog.tab, onChange: (id) => dialog.setTab(id as PostSettingsTab) });
  if (!dialog.open) return null;
  return (
    <Dialog
      open
      title={t(kindLabel === "page" ? "Page settings" : "Post settings")}
      onClose={dialog.closeDialog}
      className="jini-post-dialog jini-domain-dialog jini-post-settings-dialog"
    >
      <div className="jini-post-settings-tabs" role="tablist" aria-label={t(kindLabel === "page" ? "Page settings" : "Post settings")} onKeyDown={onKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={dialog.tab === tab.id}
            tabIndex={resolveTabBarTabIndex({ tabs: TABS, activeId: dialog.tab, tab })}
            onClick={() => dialog.setTab(tab.id)}
            {...agentHandle({ handle: `post-settings-tab-${tab.id}` }, { role: "button", label: `Show the ${tab.id} settings tab` })}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
      <div className="jini-post-settings-panel" role="tabpanel">
        {dialog.tab === "author" ? (
          <PostAuthorFields author={author} setAuthor={setAuthor} showAuthor={showAuthor} setShowAuthor={setShowAuthor} t={t} agentHandle={agentHandle} />
        ) : null}
        {dialog.tab === "publish" ? <PostPublishAtField {...publishing} t={t} agentHandle={agentHandle} /> : null}
      </div>
      <div className="jini-post-settings-dialog__footer">
        <span className="jini-post-settings-dialog__actions">
          <button
            data-jini-autofocus=""
            type="button"
            onClick={dialog.closeDialog}
            {...agentHandle({ handle: "post-settings-done" }, { role: "button", label: "Close the post settings; changes are kept and saved with the post's Save" })}
          >
            {t("Done")}
          </button>
        </span>
      </div>
    </Dialog>
  );
}

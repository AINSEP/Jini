import { FolderDropConfirmation } from "./FolderDropConfirmation.js";
import { FolderDropError } from "./FolderDropError.js";
import { FolderDropPathHint } from "./FolderDropPathHint.js";
import type { FolderDropNotice as FolderDropNoticeState } from "../../../screens/fs-files/folder-drop.rules.js";
import { useChatT } from "../../../react/kit.js";

/**
 * @file Picks between `FolderDropConfirmation`, `FolderDropError` and `FolderDropPathHint` (or none) from
 * `useFolderDrop`'s single `notice` slot — `ui.spec.md` §4's "at most one of
 * `FolderDropConfirmation` or `FolderDropError` is visible at a time" is true by construction here
 * (one `useState` slot in `use-folder-drop.hooks.ts` can only ever hold one shape), not by any
 * mutual-exclusion logic this component adds.
 *
 * Mounted above the composer's textarea in `AssistantDock.tsx`'s `leadingAccessory`, alongside
 * `SelectedAgentPluginTray` — never inside the message list, per `ui.spec.md` §6.
 */
export interface FolderDropNoticeProps {
  readonly notice: FolderDropNoticeState | null;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
  /** Passed to `FolderDropPathHint`: whether the composer's folder button is available. */
  readonly canPickFolder?: boolean;
}

export function FolderDropNotice({ notice, onDismiss, onRetry, canPickFolder = false }: FolderDropNoticeProps) {
  if (notice === null) return null;
  if (notice.kind === "path-unavailable") return <FolderDropPathHint onDismiss={onDismiss} canPickFolder={canPickFolder} useTHook={useChatT} />;
  if (notice.kind === "confirmation") {
    return (
      <FolderDropConfirmation
        path={notice.path}
        paths={notice.paths}
        replacedPreviousPath={notice.replacedPreviousPath}
        onDismiss={onDismiss}
        useTHook={useChatT}
      />
    );
  }
  return <FolderDropError path={notice.path} reason={notice.reason} onRetry={onRetry} onDismiss={onDismiss} useTHook={useChatT} />;
}

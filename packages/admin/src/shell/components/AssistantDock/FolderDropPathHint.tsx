import { Icon, type KitChatTranslator } from "../../../react/kit.js";

/**
 * @file Shown when a folder was dropped on the chat but its OS path could not be read — a plain
 * browser tab never exposes one (only the host's desktop bridge can). The drop itself
 * was swallowed so the folder never uploads; this asks for the path as pasted text instead. Stays
 * until dismissed: the operator needs it while switching to Finder/Explorer to copy the path.
 * When the composer's folder button is showing (`FolderPathButton`), it points there first.
 */
export interface FolderDropPathHintProps {
  readonly onDismiss: () => void;
  /** Whether the composer's folder button is available on this machine. */
  readonly canPickFolder?: boolean;
  /** The host's chat translator hook, injected. */
  readonly useTHook: () => KitChatTranslator;
}

export function FolderDropPathHint({ onDismiss, canPickFolder = false,
  useTHook }: FolderDropPathHintProps) {
  const t = useTHook();
  return (
    <div className="jini-folder-drop-notice jini-folder-drop-notice--hint" role="status">
      <span className="jini-folder-drop-notice__icon" aria-hidden="true">
        <Icon name="folder" size={14} />
      </span>
      <span className="jini-folder-drop-notice__label">
        {canPickFolder
          ? t("Browsers can't share folder paths. Use the folder button, or paste the path (Finder: ⌥⌘C, Explorer: Ctrl+Shift+C).")
          : t("Browsers can't share folder paths. Paste the path instead (Finder: ⌥⌘C, Explorer: Ctrl+Shift+C).")}
      </span>
      <button
        type="button"
        className="jini-folder-drop-notice__dismiss"
        onClick={onDismiss}
        aria-label={t("Dismiss")}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

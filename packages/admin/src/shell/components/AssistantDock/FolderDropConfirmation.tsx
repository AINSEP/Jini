import { Icon, type KitChatTranslator } from "../../../react/kit.js";

/**
 * @file `ui.spec.md` §1: brief, dismissible confirmation that a dropped folder is now the
 * workspace's readable `custom` fs-files root (SPEC-053, REQ-02). Renders only after the
 * `custom`-root call actually succeeds — never optimistically — per `ui.spec.md` §4; the caller
 * (the host's folder-drop hook, `useFolderDrop`) owns that timing, this component only renders what it is told.
 *
 * `autoDismissMs` (`ui.spec.md` §2.1) is intentionally NOT a prop here: `useFolderDrop` already owns
 * a single dismiss timer (`scheduleAutoDismiss`) as the one source of truth for when this notice
 * disappears. A second, component-local timer would risk two independent clocks disagreeing about
 * when to call `onDismiss` — a correctness footgun for a purely cosmetic feature, not a behavior a
 * duplicate timer buys back. The parent stops rendering this component (or unmounts) once its own
 * timer fires; there is nothing left for this component to time itself.
 */
export interface FolderDropConfirmationProps {
  /** The absolute path just set as the `custom` root. */
  readonly path: string;
  /** All folders staged by this drop; the custom file root still names only `path`. */
  readonly paths?: readonly string[] | undefined;
  /** Set when this drop replaced an already-active `custom` root — wording differs accordingly. */
  readonly replacedPreviousPath?: string | null;
  /** Auto-timeout or explicit dismiss — no state change beyond removing this notice from view. */
  readonly onDismiss: () => void;
  /** The host's chat translator hook, injected. */
  readonly useTHook: () => KitChatTranslator;
}

export function FolderDropConfirmation({ path, paths, replacedPreviousPath, onDismiss,
  useTHook }: FolderDropConfirmationProps) {
  const t = useTHook();
  return (
    <div className="jini-folder-drop-notice jini-folder-drop-notice--confirmation" role="status">
      <span className="jini-folder-drop-notice__icon" aria-hidden="true">
        <Icon name="folder" size={14} />
      </span>
      <span className="jini-folder-drop-notice__label">
        {paths && paths.length > 1 ? (
          // One sentence key, not two fragments: locales order the folder list and the root differently.
          t("Folders added to the message: {paths}. Active file root: {path}.", { paths: paths.join(", "), path })
        ) : replacedPreviousPath
          ? t("The assistant can now read {path}, replacing the previous folder.", { path })
          : t("The assistant can now read {path}.", { path })}
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

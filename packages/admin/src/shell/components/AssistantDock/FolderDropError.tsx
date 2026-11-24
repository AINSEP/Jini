import { Icon, type KitChatTranslator } from "../../../react/kit.js";

/**
 * @file `ui.spec.md` §2.2/§5: error state when the folder-drop custom-root call fails (SPEC-053,
 * REQ-04) — path missing, not a directory, or the endpoint unreachable. Renders only when that call
 * fails; the folder-path text the drop already inserted into the composer (REQ-01) is untouched
 * either way (the host's folder-drop hook inserts it before this ever has a chance to render).
 *
 * `reason` drives one of three FIXED, plain-language strings — never a raw server error string, per
 * `ui.spec.md` §5's "Error clarity" requirement and `errors.spec.md`'s own `User Message Guidance`
 * column (`DROPPED_PATH_NOT_A_DIRECTORY`, `DROPPED_PATH_NOT_FOUND`, `CUSTOM_ROOT_ENDPOINT_UNREACHABLE`).
 */
export interface FolderDropErrorProps {
  /** The path that failed to become the `custom` root. */
  readonly path: string;
  /** Drives the exact message text. */
  readonly reason: "not-a-directory" | "does-not-exist" | "endpoint-unreachable";
  /** Retry control activation — re-attempts the custom-root call with the same path. */
  readonly onRetry: (input: { path: string }) => void;
  /** Explicit dismiss — the composer's already-inserted path text is unaffected. */
  readonly onDismiss: () => void;
  /** The host's chat translator hook, injected. */
  readonly useTHook: () => KitChatTranslator;
}

/** One of `errors.spec.md`'s three fixed User Message Guidance strings, by `reason`.
 *  @complexity O(1). */
const FOLDER_DROP_MESSAGES: Record<FolderDropErrorProps["reason"], string> = {
  "not-a-directory": "That's not a folder — drop a folder to set it as the working directory.",
  "does-not-exist": "That folder couldn't be found. Make sure it still exists and try again.",
  "endpoint-unreachable": "Couldn't set the working folder right now. Try again in a moment.",
};

function messageForReason(reason: FolderDropErrorProps["reason"]): string {
  return FOLDER_DROP_MESSAGES[reason];
}

export function FolderDropError({ path, reason, onRetry, onDismiss,
  useTHook }: FolderDropErrorProps) {
  const t = useTHook();
  return (
    <div className="jini-folder-drop-notice jini-folder-drop-notice--error" role="alert">
      <span className="jini-folder-drop-notice__icon" aria-hidden="true">
        <Icon name="alert-triangle" size={14} />
      </span>
      <span className="jini-folder-drop-notice__label">{t(messageForReason(reason))}</span>
      <button
        type="button"
        className="jini-folder-drop-notice__action"
        onClick={() => onRetry({ path })}
        aria-label={t("Retry setting the working folder")}
      >
        <Icon name="refresh" size={12} />
        {t("Retry")}
      </button>
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

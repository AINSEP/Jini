import { useT } from '../../../i18n/index.js';

export interface FileDropzoneNameListProps {
  names: readonly string[];
  onRemoveName?: ((name: string) => void) | undefined;
  /** Accessible label for the list (e.g. `"{label} selections"`). */
  ariaLabel: string;
  useTHook?: typeof useT;
}

/** The simple staged-names display for the labeled/prompt-driven variant (no `File` objects retained, no thumbnails) — ported from `DesignSystemFlow.tsx`'s `DropZone`. */
export function FileDropzoneNameList({ names, onRemoveName, ariaLabel, useTHook = useT }: FileDropzoneNameListProps) {
  const t = useTHook();
  if (names.length === 0) return null;
  return (
    <div className="jini-file-dropzone__name-list" aria-label={ariaLabel}>
      {names.map((name) => (
        <span className="jini-file-dropzone__name-chip" key={name}>
          {name}
          {onRemoveName ? (
            <button
              type="button"
              className="jini-file-dropzone__name-remove"
              aria-label={t('Remove {name}', { name })}
              onClick={() => onRemoveName(name)}
            >
              <span aria-hidden>×</span>
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

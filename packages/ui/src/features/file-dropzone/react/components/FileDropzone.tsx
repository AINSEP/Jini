import { useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { useGlobalKeydown } from '../../../../browser/useGlobalKeydown.js';
import { useT } from '../../../i18n/index.js';
import { useFileDropzone } from '../hooks/useFileDropzone.js';
import { useFileDropzonePreviews } from '../hooks/useFileDropzonePreviews.js';
import { FileDropzoneThumbnailGrid } from './FileDropzoneThumbnailGrid.js';
import { FileDropzoneLightbox } from './FileDropzoneLightbox.js';
import { FileDropzoneNameList } from './FileDropzoneNameList.js';

export interface FileDropzoneSecondaryAction {
  label: string;
  onClick: () => void;
}

// Stable identity for the "no files" case — `files ?? []` would otherwise
// allocate a fresh array every render, and `useFileDropzonePreviews` keys its
// effects on `files` by reference: a fresh array every render re-triggers
// those effects, whose own `setState` calls (a new, also-fresh `Map` each
// time) re-render this component, recreating the fallback array again — an
// infinite render loop whenever `files` is omitted entirely.
const NO_FILES: File[] = [];

export interface FileDropzoneProps {
  /** Heading above the zone (e.g. `"Local code"`). Omit for a bare zone with no heading. */
  label?: string;
  /** Prompt shown inside the zone. Defaults to a generic drag/drop/browse prompt (varying on `enablePaste`). */
  prompt?: string;
  /** Helper text under the zone. */
  helper?: string;
  /** Native file input `accept` attribute. */
  accept?: string;
  /** Enables directory selection (`webkitdirectory`) on the native input, and folder-aware drag/drop (folders are always expanded on drop regardless of this flag — it only controls whether the native file-picker itself offers folder selection). */
  directory?: boolean;
  /** Enables a page-wide clipboard-paste listener that stages pasted files directly. */
  enablePaste?: boolean;

  /** Staged files for the kind-aware thumbnail-grid + lightbox variant. */
  files?: File[];
  /** Remove one staged file (thumbnail-grid variant). Omit to render the grid without remove tiles. */
  onRemove?: (file: File) => void;

  /** Staged names for the simple labeled variant (no `File` objects retained). */
  names?: string[];
  /** Remove one staged name (simple variant). Names render as plain zone text instead of a removable chip list when this is omitted. */
  onRemoveName?: (name: string) => void;

  /** Resolved files ready to stage — always the fully directory-expanded flat list, regardless of drag/click/paste origin. */
  onFiles: (files: File[]) => void;
  /** Fires on a native click on the zone. Drag/drop and paste don't trigger it. */
  onZoneClick?: () => void;
  /** Surfaces a read error (e.g. a dropped folder failed to enumerate), or clears it (`null`). */
  onError?: (message: string | null) => void;
  /** Wraps staging of a large selection so a host can show a loading affordance while it resolves — see `react/hooks/useFileDropzone.ts`. */
  onProcessingStart?: () => () => void;

  /** External browse-folder trigger (e.g. a desktop-host native folder picker), rendered as a button beside the zone. */
  onBrowseFolder?: () => void;
  /** A host-injected secondary affordance rendered below the zone (e.g. "Select from library"). Renders only when supplied — replaces the origin's product-specific feature-flag gate with plain prop presence. */
  secondaryAction?: FileDropzoneSecondaryAction;
  /** Custom hook overrides for dependency injection / testing. */
  useFileDropzone?: typeof useFileDropzone;
  useFileDropzonePreviews?: typeof useFileDropzonePreviews;
}

/**
 * Consolidates two independent OD file-staging zones into one
 * primitive: `DesignSystemAssetDropzone.tsx` (a rich, kind-aware thumbnail
 * grid with click-to-enlarge preview over staged `File[]`) and
 * `DesignSystemFlow.tsx`'s `DropZone` (a labeled, prompt-driven zone with a
 * file-dialog cancel-vs-still-loading detection heuristic and a plain
 * staged-names list). Both are the same underlying interaction — native
 * drag/drop + click-to-browse resolving to a flat `File[]` — configured
 * differently; see `packages/ui/source-map.md` for the full writeup.
 */
export function FileDropzone({
  label,
  prompt,
  helper,
  accept,
  directory = false,
  enablePaste = false,
  files,
  onRemove,
  names,
  onRemoveName,
  onFiles,
  onZoneClick,
  onError,
  onProcessingStart,
  onBrowseFolder,
  secondaryAction,
  useFileDropzone: useFileDropzoneHook = useFileDropzone,
  useFileDropzonePreviews: useFileDropzonePreviewsHook = useFileDropzonePreviews,
}: FileDropzoneProps) {
  const t = useT();
  const [lightboxFile, setLightboxFile] = useState<File | null>(null);

  const dropzone = useFileDropzoneHook({ onFiles, onZoneClick, onError, onProcessingStart, enablePaste });
  const previews = useFileDropzonePreviewsHook(files ?? NO_FILES);

  useGlobalKeydown(
    (event) => {
      if (event.key === 'Escape') setLightboxFile(null);
    },
    { enabled: lightboxFile !== null },
  );

  function onZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dropzone.openPicker();
    }
  }

  const defaultPrompt = enablePaste ? t('Drag & drop, paste, or browse') : t('Drag & drop or browse');
  const promptText = prompt ? t(prompt) : defaultPrompt;
  const isSimpleVariant = names !== undefined;
  const showNamesInZone = !!names && names.length > 0 && !onRemoveName;
  const zoneText = showNamesInZone ? names!.join(', ') : promptText;
  const directoryInputProps = directory ? ({ webkitdirectory: '', directory: '' } as Record<string, string>) : {};

  return (
    <div className="jini-file-dropzone">
      {label ? <strong className="jini-file-dropzone__label">{t(label)}</strong> : null}
      <div className="jini-file-dropzone__wrap">
        <div
          className={`jini-file-dropzone__zone${dropzone.dragOver ? ' is-drag-over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={t('Add files — drag and drop{paste}, or click to browse', {
            paste: enablePaste ? t(', paste') : '',
          })}
          data-testid="file-dropzone-zone"
          onClick={dropzone.openPicker}
          onKeyDown={onZoneKeyDown}
          onDragEnter={dropzone.onZoneDragEnter}
          onDragOver={dropzone.onZoneDragOver}
          onDragLeave={dropzone.onZoneDragLeave}
          onDrop={dropzone.onZoneDrop}
        >
          <input
            ref={dropzone.inputRef}
            type="file"
            multiple
            accept={accept}
            className="jini-file-dropzone__input"
            onClick={(event) => {
              // The input is nested inside the zone div so a real user
              // click on it (e.g. via `openPicker`'s own `input.click()`
              // call) would otherwise bubble straight back into the zone's
              // own `onClick={dropzone.openPicker}`, re-triggering it and
              // opening the file dialog a second time.
              event.stopPropagation();
              dropzone.onInputClick();
            }}
            onChange={dropzone.onInputChange}
            {...directoryInputProps}
          />
          <span className="jini-file-dropzone__icon">
            <Icon name="upload" size={19} />
          </span>
          <span className="jini-file-dropzone__prompt">{zoneText}</span>
          {!isSimpleVariant && helper ? <span className="jini-file-dropzone__hint">{t(helper)}</span> : null}
        </div>
        {onBrowseFolder ? (
          <button type="button" className="jini-file-dropzone__browse-folder" onClick={onBrowseFolder}>
            {t('Browse folder')}
          </button>
        ) : null}
      </div>

      {secondaryAction ? (
        <div className="jini-file-dropzone__secondary">
          <button type="button" className="jini-file-dropzone__secondary-action" onClick={secondaryAction.onClick}>
            {t(secondaryAction.label)}
          </button>
        </div>
      ) : null}

      {names && names.length > 0 && onRemoveName ? (
        <FileDropzoneNameList
          names={names}
          onRemoveName={onRemoveName}
          ariaLabel={label ? t('{label} selections', { label: t(label) }) : t('Selections')}
        />
      ) : null}

      {files && files.length > 0 ? (
        <FileDropzoneThumbnailGrid files={files} previews={previews} onSelect={setLightboxFile} onRemove={onRemove} />
      ) : null}

      {isSimpleVariant && helper ? <p className="jini-file-dropzone__helper">{t(helper)}</p> : null}

      {lightboxFile ? (
        <FileDropzoneLightbox file={lightboxFile} previews={previews} onClose={() => setLightboxFile(null)} />
      ) : null}
    </div>
  );
}

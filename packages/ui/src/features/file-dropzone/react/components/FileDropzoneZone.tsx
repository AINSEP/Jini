import type { KeyboardEvent } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import type { UseFileDropzoneResult } from '../hooks/useFileDropzone.js';

export interface FileDropzoneZoneProps {
  dropzone: UseFileDropzoneResult;
  /** Text shown inside the zone (the prompt, or the staged names for the simple variant without remove chips). */
  zoneText: string;
  accept?: string | undefined;
  directory?: boolean | undefined;
  enablePaste?: boolean | undefined;
  /** Already-translated hint shown inside the zone under the prompt. */
  hint?: string | undefined;
}

/** The keyboard-activatable drag/drop/click zone of `FileDropzone`, with its nested native file input. Internal to the file-dropzone feature. */
export function FileDropzoneZone({ dropzone, zoneText, accept, directory, enablePaste, hint }: FileDropzoneZoneProps) {
  const t = useT();

  function onZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dropzone.openPicker();
    }
  }

  const directoryInputProps = directory ? ({ webkitdirectory: '', directory: '' } as Record<string, string>) : {};

  return (
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
      {hint ? <span className="jini-file-dropzone__hint">{hint}</span> : null}
    </div>
  );
}

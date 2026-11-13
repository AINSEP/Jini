import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import type { UseFileDropzoneResult } from '../hooks/useFileDropzone.js';
import { useFileDropzoneZone } from './FileDropzoneZone.hooks.js';

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

  const { onZoneKeyDown, onInputClick, directoryInputProps } = useFileDropzoneZone({ dropzone, directory });

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
        onClick={onInputClick}
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

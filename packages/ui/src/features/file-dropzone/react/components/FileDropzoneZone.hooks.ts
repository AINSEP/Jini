import type { KeyboardEvent, MouseEvent } from 'react';
import type { UseFileDropzoneResult } from '../hooks/useFileDropzone.js';

/** Wire keyboard activation and prevent the nested input from reopening its picker. */
export function useFileDropzoneZone({ dropzone, directory }: { dropzone: UseFileDropzoneResult; directory: boolean | undefined }, _options = {}) {
  function onZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dropzone.openPicker();
    }
  }
  function onInputClick(event: MouseEvent<HTMLInputElement>) {
    // The input is nested inside the zone div so a real user
    // click on it (e.g. via `openPicker`'s own `input.click()`
    // call) would otherwise bubble straight back into the zone's
    // own `onClick={dropzone.openPicker}`, re-triggering it and
    // opening the file dialog a second time.
    event.stopPropagation();
    dropzone.onInputClick();
  }
  const directoryInputProps = directory ? ({ webkitdirectory: '', directory: '' } as Record<string, string>) : {};
  return { onZoneKeyDown, onInputClick, directoryInputProps };
}

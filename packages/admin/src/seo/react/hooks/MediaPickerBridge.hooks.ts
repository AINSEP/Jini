import { useEffect, useRef, useState } from 'react';
import type { SeoMediaPickerSlotProps } from '../options.js';
import type { SeoMediaSelection } from '../../models.js';
import { useSeoPorts } from './SeoPorts.hooks.js';
export function useMediaPickerBridge(required: SeoMediaPickerSlotProps, _optional: Record<string, never> = {}) {
  const { mediaPicker } = useSeoPorts();
  const callbacks = useRef(required);
  callbacks.current = required;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaPicker) { setError('Media picker unavailable'); return; }
    const abort = new AbortController();
    void mediaPicker.pick({ accept: callbacks.current.accept ?? ['image/*'] }, { signal: abort.signal }).then(item => {
      if (abort.signal.aborted) return;
      if (item) callbacks.current.onSelect(item as SeoMediaSelection);
      else callbacks.current.onCancel();
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Media picker unavailable'); });
    return () => abort.abort();
  }, [mediaPicker]);
  return { error, cancel: () => callbacks.current.onCancel() };
}

import type { FetchQueryAdapter } from '@jini-ai/core/fetch';
import { formatUserFacingError, type SecretRedactionOptions, type UserFacingError } from '@jini-ai/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaPickerPort } from '../../../contracts/media-picker.js';

/** Structural slice of the host's media row: only what the picker matches on. */
export interface JiniMediaPickerRow { readonly id: string; readonly status: string }

/** The legacy dialog's callbacks plus every host collaborator the bridge needs. */
export interface JiniMediaPickerArgs<TMedia extends JiniMediaPickerRow> {
  onSelect: (item: TMedia) => void;
  onCancel: () => void;
  /** The host's legacy-dialog seam: when a caller injects it, the host renders its own dialog and this bridge stays off. */
  useDialog?: unknown;
  /** Content types the caller can use; omit (or `[]`) to offer every asset. */
  accept?: readonly string[];
  /** The mounted admin's promise picker service, or `null` outside an admin scope. */
  picker: MediaPickerPort | null;
  /** The host's own authenticated media list, re-read so the CMS row (with its readable slug) comes back. */
  port: { listMedia(): Promise<{ media: TMedia[] }> };
  /** The host's redaction policy for the copyable error evidence. */
  errorRedaction: SecretRedactionOptions;
  /** Reads the host's incident id from a failed request, when its transport carries one. */
  errorIdOf: (cause: unknown) => string | undefined;
  /** The host kit's cached-loader hook; required, Jini ships no default. */
  useCachedLoader: FetchQueryAdapter['useCachedLoader'];
}

/** The shared dialog is the compatibility boundary for editor, SEO and widget callers.
 * The service selects an asset; the host resolves its CMS fields (notably readable slug)
 * through the same authenticated route, without leaking those fields into the generic port. */
export function useJiniMediaPicker<TMedia extends JiniMediaPickerRow>(args: JiniMediaPickerArgs<TMedia>, _optional: Record<string, never> = {}) {
  const { picker, port, useCachedLoader } = args;
  const key = useMemo(() => ["media"] as const, []);
  const fetchMedia = useCallback(() => port.listMedia(), [port]);
  const media = useCachedLoader({ key, fetch: fetchMedia }, { staleTime: 0 });
  const enabled = !!picker && !args.useDialog;
  const callbacks = useRef(args); callbacks.current = args;
  const [error, setError] = useState<UserFacingError | null>(null);
  useEffect(() => {
    if (!enabled || !picker) return undefined;
    const abort = new AbortController();
    void picker.pick({ accept: callbacks.current.accept ?? [] }, { signal: abort.signal }).then(async selected => {
      if (abort.signal.aborted) return;
      if (!selected) { callbacks.current.onCancel(); return; }
      const rows = await media.load();
      const row = rows.media.find(item => item.id === selected.id && item.status === 'active');
      if (!row) throw new Error('Selected media is unavailable');
      if (!abort.signal.aborted) callbacks.current.onSelect(row);
    }).catch(cause => {
      if (abort.signal.aborted) return;
      const errorId = callbacks.current.errorIdOf(cause);
      setError(formatUserFacingError({ message: 'The media could not be chosen.',
        action: 'Cancel and choose the media again.', step: 'Choose media', cause }, {
        ...callbacks.current.errorRedaction,
        ...(errorId === undefined ? {} : { errorId }),
      }));
    });
    return () => abort.abort();
  }, [picker, enabled, media]);
  return { enabled, error, onCancel: args.onCancel };
}

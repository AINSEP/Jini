import { useEffect } from 'react';
import { useMediaLibraryQuery } from './MediaQuery.hooks.js';
import { useController } from '../../../core/react/use-controller.js';
import { createLibraryController } from '../../controllers/library.controller.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';
import { acceptsMedia } from '../../rules.js';
export interface MediaPickerProps {
  readonly api: MediaApiPort;
  readonly accept: readonly string[];
  readonly onChoose: (asset: MediaAsset | null) => void;
  readonly onClose: () => void;
}
export function useMediaPicker(props: MediaPickerProps, _optional: Record<string, never> = {}) {
  const cached = useMediaLibraryQuery({ api: props.api });
  const { controller, snapshot } = useController(
    { create: () => createLibraryController({ api: cached.api }), dependencies: [cached.api] },
    {
      start: ({ controller }) => {
        void controller.load();
      },
    },
  );
  useEffect(() => { controller?.settleLibrary({ ...(cached.query.data ? { all: cached.query.data } : {}), error: cached.query.error }); }, [controller, cached.query.data, cached.query.error]);
  const actions = (snapshot?.items ?? [])
    .filter((item) => item.status === 'active' && acceptsMedia({ item, accept: props.accept }))
    .map((item) => ({ item, onChoose: () => props.onChoose(item) }));
  return {
    ...props,
    snapshot,
    actions,
    loading: !snapshot || (snapshot.loading && !snapshot.error),
    onRetry: () => { void controller?.load(); },
    onSearch: ({ value: search }: { value: string }) => {
      void controller?.setQuery({ query: { search } });
    },
    search: snapshot?.query.search ?? '',
  };
}

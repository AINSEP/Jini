import type { ReactNode } from 'react';
import { createElement } from 'react';
import { bindReact } from '../../core/react/bind-react.js';
import type { OverlayPort } from '../../react/overlays.js';
import { mediaModule } from '../media.module.js';
import type { MediaApiPort } from '../ports.js';
import type { MediaPickerPort } from '../../contracts/media-picker.js';
import { MediaPortsContext } from './hooks/MediaPorts.hooks.js';
export type { MediaPageProps } from './hooks/MediaPage.hooks.js';
export { useMediaPorts } from './hooks/MediaPorts.hooks.js';
/** One module factory per mounted admin scope. Tabs and even the picker are loaded on demand. */
export function media(
  { overlays }: { overlays: OverlayPort },
  { headerActions }: { headerActions?: ReactNode } = {},
) {
  const module = {
    ...mediaModule,
    factories: {
      mediaPicker: (
        {
          ports,
          permissions,
        }: { ports: Readonly<Record<string, unknown>>; permissions: readonly string[] },
        _optional: Record<string, never> = {},
      ): MediaPickerPort & { dispose(): void } => {
        const pending = new Set<AbortController>();
        let disposed = false;
        return {
          async pick({ accept }, { signal } = {}) {
            if (disposed) return null;
            if (!permissions.includes('media.read'))
              throw new Error('Permission denied: media.read');
            const abort = new AbortController();
            pending.add(abort);
            const onAbort = () => abort.abort();
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) abort.abort();
            try {
              const { MediaPicker } = await import('./components/MediaPicker.js');
              if (abort.signal.aborted) return null;
              return await overlays.open(
                {
                  render: ({ resolve, cancel }) =>
                    createElement(MediaPicker, {
                      api: ports.mediaApi as MediaApiPort,
                      accept,
                      onChoose: resolve,
                      onClose: cancel,
                    }),
                },
                { signal: abort.signal },
              );
            } finally {
              signal?.removeEventListener('abort', onAbort);
              pending.delete(abort);
            }
          },
          dispose() {
            disposed = true;
            for (const abort of pending) abort.abort();
            pending.clear();
          },
        };
      },
    },
  };
  const react = bindReact(
    {
      module,
      views: {
        library: {
          page: async () => {
            const { MediaPage } = await import('./pages/MediaPage.js');
            return { default: (props: import('../../react/bind-react.js').ModulePageProps) =>
              createElement(MediaPage, { ...props, headerActions }) };
          },
          tabs: {
            all: () => import('./tabs/LibraryTab.js'),
            images: () => import('./tabs/LibraryTab.js'),
            videos: () => import('./tabs/LibraryTab.js'),
            'external-providers': () => import('./tabs/ProvidersTab.js'),
          },
        },
      },
    },
    { context: MediaPortsContext },
  );
  return Object.assign(module, { react });
}

// Styling: scoped feature presentation used to travel with compiled JS (a `mediaStyles` string in
// `media presentation`), which also overrode host dialog CSS that could accidentally display a closed
// dialog or shrink a large media preview. Host CSS now supplies presentation and the closed-dialog
// safeguards on jini- classes, so no style string ships from this module.
export { useGallerySelection, type GallerySelectionImage } from './hooks/GallerySelection.hooks.js';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import type { AdminInstance, AdminModuleUi, UseAdminController } from '@jini-ai/core/contracts/admin-module';
import type { OverlayPort } from '../../react/overlays.js';
import { mediaModule } from '../media.module.js';
import type { MediaApiPort } from '../ports.js';
import type { MediaPickerPort } from '../../contracts/media-picker.js';
import { MediaPortsContext, MediaControllerContext } from './hooks/MediaPorts.hooks.js';
export type { MediaPageProps } from './hooks/MediaPage.hooks.js';
export { useMediaPorts, MediaControllerContext } from './hooks/MediaPorts.hooks.js';
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
/** The host's overlay renders the picker outside this module's Provider, so the picker carries the
 * injected controller hook itself. */
function mediaPickerFactory({ overlays, useController }: { overlays: OverlayPort; useController: UseAdminController }) {
  return (
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
                createElement(MediaControllerContext.Provider, { value: useController }, createElement(MediaPicker, {
                  api: ports.mediaApi as MediaApiPort,
                  accept,
                  onChoose: resolve,
                  onClose: cancel,
                })),
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
  };
}
/** One module factory per mounted admin scope. Tabs and even the picker are loaded on demand. */
export function media<Page, Tab>(
  { ui, overlays }: { ui: ModuleUi<Page, Tab>; overlays: OverlayPort },
  { headerActions }: { headerActions?: ReactNode } = {},
) {
  const module = {
    ...mediaModule,
    factories: {
      mediaPicker: mediaPickerFactory({ overlays, useController: ui.useController }),
    },
  };
  const react = ui.bindReact(
    {
      module,
      views: {
        library: {
          page: async () => {
            const { MediaPage } = await import('./pages/MediaPage.js');
            return { default: (props: import('./hooks/MediaPage.hooks.js').MediaPageProps) =>
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
  function Provider({ admin, children }: { admin: AdminInstance; children: ReactNode }, _optional: Record<string, never> = {}) {
    return createElement(MediaControllerContext.Provider, { value: ui.useController }, createElement(react.Provider, { admin, children }));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}

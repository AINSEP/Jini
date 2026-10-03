import { useCallback, useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { AdminShellNavigationPort } from './types.js';

/** Internal shell wiring: a route snapshot and host-installed SPA link interception. */
export function useShellRoute(args: { readonly navigation: AdminShellNavigationPort; readonly base: string }): string {
  const { navigation, base } = args;
  const subscribe = useCallback((onChange: () => void) => navigation.subscribe({ base, onChange }), [navigation, base]);
  const read = useCallback(() => navigation.readRoute({ base }), [navigation, base]);
  const routePath = useSyncExternalStore(subscribe, read, read);
  useEffect(() => navigation.installLinkInterceptor({ base }), [navigation, base]);
  return routePath;
}

/** Mobile overlay state, independent of the Sidebar's persisted desktop rail state. */
export function useShellDrawer(args: { readonly routePath: string }): { readonly open: boolean; readonly setOpen: Dispatch<SetStateAction<boolean>> } {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [args.routePath]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return { open, setOpen };
}

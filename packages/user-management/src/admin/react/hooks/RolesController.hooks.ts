import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createRolesController } from '../../controllers/roles.controller.js';
import type { RolesController } from '../../controllers/roles.controller.js';
import { useRolesScope } from './RolesBinding.hooks.js';
/** Controller creation belongs to the effect, so StrictMode replay gets a fresh instance.
 * Both tabs read the page-owned controller; neither tab starts its own duplicate fetches. */
export function useRolesController(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { api, permissions } = useRolesScope({});
    const grantKey = JSON.stringify(permissions);
    const [attachment, setAttachment] = useState<{
        controller: RolesController;
        api: typeof api;
        grantKey: string;
    } | null>(null);
    // A host/workspace swap cannot render the previous scope's data while its new effect attaches.
    const controller = attachment?.api === api && attachment.grantKey === grantKey ? attachment.controller : null;
    useEffect(() => {
        const current = createRolesController({ api }, { permissions });
        setAttachment({ controller: current, api, grantKey });
        void current.load({});
        return () => current.dispose({});
        // grantKey is the immutable grant value, independent of a Provider's object identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, grantKey]);
    const subscribe = useCallback((listener: () => void) => controller?.subscribe({ listener }) ?? (() => { }), [controller]);
    const read = useCallback(() => controller?.getSnapshot() ?? null, [controller]);
    const state = useSyncExternalStore(subscribe, read, () => null);
    return { controller, state, permissions };
}

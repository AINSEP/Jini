/**
 * @file Type-level pin for the hook-injection rule on `EditMediaPanel`: its view-model hook is a
 * required prop, so a mount that names the real hook compiles and a mount that omits it does not.
 * If someone restores an optional default (`useEditMediaPanelHook = useEditMediaPanel`), the
 * `@ts-expect-error` below becomes unused and `tsc --noEmit` fails. Never executed; checked only by tsc.
 */
import { createMemoryMediaApi } from '../../adapters/memory.js';
import type { MediaAsset } from '../../models.js';
import { EditMediaPanel } from '../components/EditMediaPanel.js';
import { useEditMediaPanel } from '../hooks/EditMediaPanel.hooks.js';

declare const item: MediaAsset;
const props = { item, api: createMemoryMediaApi({ assets: [] }), onSaved: () => {}, onClose: () => {} };

export const withHook = <EditMediaPanel {...props} useEditMediaPanelHook={useEditMediaPanel} />;
// @ts-expect-error -- the panel hook is required; omitting it must not compile.
export const withoutHook = <EditMediaPanel {...props} />;

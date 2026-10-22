import { useWidgetRegionEditor as useModule } from '../../hooks/use-widget-region-editor.hooks.js';
import { useApi, useTranslation } from './bridge.js';
import { t as translate } from './widgets-i18n.js';
import type { WidgetRegionsPort } from './legacy-ports.js';
import type { WidgetsTranslate } from '../../../models.js';
export type { WidgetRegionEditorController } from '../../hooks/use-widget-region-editor.hooks.js';
export const staleRegionVersionMessage = (locale: string) => translate({ locale, key: 'This region changed since you loaded it, refresh and try again.' });
export function useWidgetRegionEditor(regionKey: string, { port, locale, t }: { port: WidgetRegionsPort; locale: string; t: WidgetsTranslate }) { return useModule({ regionKey, api: useApi(port) }, { locale, t: useTranslation(locale, t) }); }

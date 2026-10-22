import { useWidgetRegions as useModule } from '../../hooks/use-widget-regions.hooks.js';
import { useApi, useTranslation } from './bridge.js';
import { events } from './events.js';
import type { WidgetRegionsPort } from './legacy-ports.js';
import type { WidgetsTranslate } from '../../../models.js';
export type { WidgetRegionsController } from '../../hooks/use-widget-regions.hooks.js';
export function useWidgetRegions({ port, locale, t, navigate }: { port: WidgetRegionsPort; locale: string; t: WidgetsTranslate; navigate: (path: string) => void }) { return useModule({ api: useApi(port) }, { locale, t: useTranslation(locale, t), events, navigate }); }

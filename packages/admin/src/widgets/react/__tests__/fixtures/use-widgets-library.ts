import { useWidgetsLibrary as useModule } from '../../hooks/use-widgets-library.hooks.js';
import { useApi, useTranslation } from './bridge.js';
import { events } from './events.js';
import type { WidgetsPort } from './legacy-ports.js';
import type { WidgetsTranslate } from '../../../models.js';
export type { WidgetsLibraryController } from '../../hooks/use-widgets-library.hooks.js';
export function useWidgetsLibrary({ port, locale, t }: { port: WidgetsPort; locale: string; t: WidgetsTranslate }) { return useModule({ api: useApi(port) }, { locale, t: useTranslation(locale, t), events }); }

import { useWidgetInstanceEditor as useModule } from '../../hooks/use-widget-instance-editor.hooks.js';
import { useApi, useTranslation } from './bridge.js';
import { api } from './api.js';
import { navigate } from './navigation.js';
import { defaultConfig, slugRedirectPath } from './catalog.js';
import type { WidgetsPort } from './legacy-ports.js';
import type { WidgetsTranslate, WidgetEditorParams } from '../../../models.js';
export type { WidgetInstanceEditorController } from '../../hooks/use-widget-instance-editor.hooks.js';
export function useWidgetInstanceEditor(params: WidgetEditorParams, { port, locale, t, navigate }: { port: WidgetsPort; locale: string; t: WidgetsTranslate; navigate: (path: string, options?: { replace?: boolean }) => void }) { return useModule({ params, api: useApi(port), defaultConfig }, { locale, t: useTranslation(locale, t), navigate, slugRedirectPath }); }
export function useWiredWidgetInstanceEditor(params: WidgetEditorParams) { return useWidgetInstanceEditor(params, { port: api, locale: 'en', t: key => key, navigate }); }

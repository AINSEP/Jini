import { useMemo, useRef } from 'react';
import type { AdminWidgetsPort } from '../../../ports.js';
import type { WidgetsPort, WidgetRegionsPort } from './legacy-ports.js';
import { api } from './api.js';
import { t as translate } from './widgets-i18n.js';
import type { WidgetsTranslate } from '../../../models.js';
export function useApi(port: WidgetsPort | WidgetRegionsPort): AdminWidgetsPort {
  return useMemo(() => {
    const instances = port as WidgetsPort, regions = port as WidgetRegionsPort;
    return {
      listWidgets: input => Object.keys(input).length ? (instances.listWidgets ?? api.listWidgets)(input) : (instances.listWidgets ?? api.listWidgets)(),
      getWidget: ({ id }) => port.getWidget(id) as ReturnType<AdminWidgetsPort['getWidget']>,
      createWidget: input => (instances.createWidget ?? api.createWidget)(input), updateWidget: input => (instances.updateWidget ?? api.updateWidget)(input),
      trashWidget: ({ id }) => (instances.trashWidget ?? api.trashWidget)(id),
      listWidgetRegions: () => (regions.listWidgetRegions ?? api.listWidgetRegions)(), bindWidgetRegion: ({ regionKey }) => (regions.bindWidgetRegion ?? api.bindWidgetRegion)(regionKey),
      getWidgetRegion: ({ regionKey }) => (regions.getWidgetRegion ?? api.getWidgetRegion)(regionKey), mutateWidgetRegionPlacements: input => (regions.mutateWidgetRegionPlacements ?? api.mutateWidgetRegionPlacements)(input),
    };
  }, [port]);
}
export function useTranslation(locale: string, t: WidgetsTranslate): WidgetsTranslate {
  // Copied DI tests supplied identity for chrome while the old hook independently translated
  // notices. The host dictionary now owns both; keep those unchanged locale assertions.
  const latest = useRef(t); latest.current = t;
  return useMemo(() => (key: string) => { const local = latest.current(key); return local === key ? translate({ locale, key }) : local; }, [locale]);
}

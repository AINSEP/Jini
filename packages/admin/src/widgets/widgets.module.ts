import { defineAdminModule } from '../core/module/index.js';
import { widgetsApiToken, widgetsEventsToken, widgetsNavigationToken } from './ports.js';
import { widgetsMessagesEn } from './messages.en.js';
// Region pages share the host agent id; route-specific module page ids do not replace it.
export const widgetsAgentPageIds = { library: 'widgets', editor: 'widgets', regions: 'widget-regions', region: 'widget-regions' } as const;
export const widgetsEditorPaths = ['/widgets/new', '/widgets/:widgetId'] as const;
/** No client permissions are declared, matching the host panels; servers authorize widgets.*. */
export const widgetsModule = defineAdminModule({
  id: 'widgets',
  requires: { widgetsApi: widgetsApiToken },
  optional: { widgetsEvents: widgetsEventsToken, widgetsNavigation: widgetsNavigationToken },
  messages: widgetsMessagesEn,
  pages: {
    library: { path: '/widgets', label: 'Widgets', agentReachable: true, nav: { group: 'Content' }, tabs: {} },
    // core currently supports one path per page; /new is dispatched to this same editor by the host.
    editor: { path: '/widgets/:widgetId', label: 'Edit widget', agentReachable: true, tabs: {} },
    regions: { path: '/widgets/regions', label: 'Widget Regions', agentReachable: true, tabs: {} },
    region: { path: '/widgets/regions/:regionKey', label: 'Region:', agentReachable: true, tabs: {} },
  },
});

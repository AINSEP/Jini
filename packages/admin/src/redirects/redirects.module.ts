import { defineAdminModule } from '../core/module/index.js';
import { redirectsApiToken, redirectsEventsToken } from './ports.js';
import { redirectsMessagesEn } from './messages.en.js';
/** Existing route identity and permission are part of the host's navigation contract. */
export const redirectsModule = defineAdminModule({
  id: 'redirects',
  requires: { redirectsApi: redirectsApiToken },
  optional: { redirectsEvents: redirectsEventsToken },
  messages: redirectsMessagesEn,
  pages: { list: { path: '/redirects', label: 'Redirects', permissions: ['admin.redirects.manage'],
    agentReachable: true, nav: { group: 'marketing', icon: 'arrow-right' }, tabs: {} } },
});

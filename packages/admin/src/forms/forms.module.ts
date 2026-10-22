import { defineAdminModule } from '../core/module/define-admin-module.js';
import { formsApiToken, formsTrashToken, formsEventsToken, formsNavigationToken } from './ports.js';
import { formsMessagesEn } from './messages.en.js';
export const formsModule = defineAdminModule({
  id: 'forms',
  requires: { formsApi: formsApiToken, formsTrash: formsTrashToken },
  optional: { formsEvents: formsEventsToken, formsNavigation: formsNavigationToken },
  messages: formsMessagesEn,
  pages: {
    list: { path: '/forms', label: 'Forms', permissions: ['admin.forms.manage'], agentReachable: true, nav: { group: 'content', icon: 'forms' }, tabs: {} },
    editor: { path: '/forms/:formId', label: 'Form', permissions: ['admin.forms.manage'], agentReachable: true, tabs: {
      fields: { label: 'Fields', agentReachable: true },
      submissions: { label: 'Submissions', agentReachable: true },
    } },
  },
});

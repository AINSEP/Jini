import { defineAdminModule } from '../core/module/define-admin-module.js';
import { commentsApiToken, commentsSessionToken, commentsEventsToken } from './ports.js';
import { commentsMessagesEn } from './messages.en.js';

export const commentsModule = defineAdminModule({
  id: 'comments',
  requires: { commentsApi: commentsApiToken, commentsSession: commentsSessionToken },
  optional: { commentsEvents: commentsEventsToken },
  messages: commentsMessagesEn,
  pages: {
    queue: {
      path: '/comments', label: 'Comments', permissions: ['comments.read'],
      agentReachable: true, nav: { group: 'people', icon: 'message-circle' }, tabs: {},
    },
  },
});

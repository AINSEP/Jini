import { defineAdminModule } from '../core/module/index.js';
import { sourceControlApiToken } from './ports.js';
import { credentialManagementToken } from '../contracts/credential-management.js';
import { sourceControlMessagesEn as m } from './messages.en.js';
export const sourceControlModule = defineAdminModule({ id: 'source-control', requires: { sourceControlApi: sourceControlApiToken }, optional: { sourceControlNavigation: credentialManagementToken }, messages: m, pages: { sourceControl: { path: '/source-control', label: m.title, permissions: ['source-control.read'], nav: { group: 'operations', icon: 'git' }, tabs: { providers: { label: m.providers } } } } });

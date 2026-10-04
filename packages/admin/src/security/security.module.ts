import { defineAdminModule } from '../core/module/index.js';
import { securityApiToken, otherCredentialsToken, rootKeyToken } from './ports.js';
import { securityMessagesEn } from './messages.en.js';
export const securityModule = defineAdminModule({ id: 'security', requires: { securityApi: securityApiToken }, optional: { otherCredentials: otherCredentialsToken, rootKey: rootKeyToken }, messages: securityMessagesEn, pages: { secrets: { path: '/secrets', label: securityMessagesEn.security, permissions: ['security.read'], nav: { group: 'system', icon: 'key' }, tabs: { 'access-tokens': { label: securityMessagesEn.accessTokens }, 'root-key': { label: securityMessagesEn.rootKey, permissions: ['admin.security.tokens.manage'], optional: { rootKey: rootKeyToken } } } } } });

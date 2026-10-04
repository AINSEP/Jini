import { defineAdminModule } from '../core/module/index.js';
import { playgroundRenderTargetToken } from '../contracts/playground-render-target.js';
import { playgroundMessagesEn } from './messages.en.js';
export const playgroundModule = defineAdminModule({ id: 'playground', requires: { playgroundTargets: playgroundRenderTargetToken }, messages: playgroundMessagesEn, pages: { playground: { path: '/playground', label: playgroundMessagesEn.title, permissions: ['playground.read'], nav: { group: 'studio', icon: 'canvas' }, tabs: { canvas: { label: playgroundMessagesEn.canvas } } } } });

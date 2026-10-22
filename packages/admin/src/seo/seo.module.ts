import { defineAdminModule } from '../core/module/index.js';
import { mediaPickerToken } from '../contracts/media-picker.js';
import { seoApiToken, seoEventsToken } from './ports.js';
import { seoMessagesEn } from './messages.en.js';
/** Cadence separates defaults, sitemap operations and one-entry edits; the form stays whole. */
export const seoModule = defineAdminModule({
  id: 'seo', requires: { seoApi: seoApiToken }, optional: { seoEvents: seoEventsToken, mediaPicker: mediaPickerToken }, messages: seoMessagesEn,
  pages: { settings: {
    path: '/seo', label: 'SEO', permissions: ['admin.seo.manage'], agentReachable: true,
    nav: { group: 'content', icon: 'search' },
    tabs: { defaults: { label: 'Site defaults', agentReachable: true }, sitemap: { label: 'Sitemap', agentReachable: true }, entries: { label: 'Pages & posts', agentReachable: true } },
  } },
});

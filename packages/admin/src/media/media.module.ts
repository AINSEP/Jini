import { defineAdminModule } from '../core/module/index.js';
import { mediaPickerToken } from '../contracts/media-picker.js';
import { mediaApiToken, mediaProvidersToken, mediaEventsToken } from './ports.js';
import { mediaMessagesEn } from './messages.en.js';
/** "External Providers": credentials for outside media generation services belong
 * beside the media they generate, not beside MCP/webhook plumbing. Last in the list —
 * an operator reaches for All/Images/Videos far more often than provider credentials,
 * and the three content tabs read as one group with this one set apart. */
export const mediaModule = defineAdminModule({
  id: 'media',
  requires: { mediaApi: mediaApiToken },
  optional: { mediaProviders: mediaProvidersToken, mediaEvents: mediaEventsToken },
  provides: { mediaPicker: mediaPickerToken },
  messages: mediaMessagesEn,
  pages: {
    library: {
      path: '/media',
      label: mediaMessagesEn.media,
      permissions: ['media.read'],
      agentReachable: true,
      nav: { group: 'content', icon: 'image' },
      tabs: {
        all: { label: mediaMessagesEn.all, params: { filter: 'all' }, agentReachable: true },
        images: {
          label: mediaMessagesEn.images,
          params: { filter: 'images' },
          agentReachable: true,
        },
        videos: {
          label: mediaMessagesEn.videos,
          params: { filter: 'videos' },
          agentReachable: true,
        },
        'external-providers': {
          label: mediaMessagesEn.providers,
          permissions: ['media.providers'],
          optional: { mediaProviders: mediaProvidersToken },
        },
      },
    },
  },
});

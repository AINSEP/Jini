import { DEFAULT_FAILURE_SOUND_ID, DEFAULT_SUCCESS_SOUND_ID } from './notifications-catalog.js';
import type { NotificationsPreferences } from './types.js';

export const DEFAULT_NOTIFICATIONS_PREFERENCES: NotificationsPreferences = {
  soundEnabled: false,
  successSoundId: DEFAULT_SUCCESS_SOUND_ID,
  failureSoundId: DEFAULT_FAILURE_SOUND_ID,
  desktopEnabled: false,
};

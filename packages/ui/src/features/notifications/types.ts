/**
 * Origin: `NotificationsSection` in `SettingsDialog.tsx` (completion-sound
 * toggle/picker + browser Notification-permission flow), GENERIC per
 * `ADS-memory/reports/jini-port/recon/r6-god-component-internals.md` §1.3 — browser-API
 * only, zero product-domain coupling. See `packages/ui/source-map.md` for
 * the full provenance note.
 */
import type { SoundId } from './notifications-catalog.js';

export interface NotificationsPreferences {
  soundEnabled: boolean;
  successSoundId: SoundId;
  failureSoundId: SoundId;
  desktopEnabled: boolean;
}

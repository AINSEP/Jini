/**
 * The completion-signal sound catalog: ids, labels, and defaults.
 *
 * Split out of `@jini-ai/ui`'s `utils/notifications.ts`, which is otherwise
 * browser-bound (it drives `AudioContext`, the `Notification` constructor, and
 * a service-worker registration). This half is plain data — a settings tab has
 * to name the choices to render them, and naming them requires no DOM at all.
 * Keeping the catalog here is what lets this package stay `runtime: universal`
 * while the player stays where the Web Audio API is available.
 *
 * `utils/notifications.ts` re-exports every symbol below, so existing imports
 * of it keep resolving unchanged.
 */

export type SoundId = string;

export interface SoundOption {
  id: SoundId;
  /** i18n key rather than a literal — the sound catalog has no fixed
   *  dictionary type to key into, so hosts translate these themselves. */
  labelKey: string;
}

export const SUCCESS_SOUNDS: SoundOption[] = [
  { id: 'ding', labelKey: 'notifications.sound.ding' },
  { id: 'chime', labelKey: 'notifications.sound.chime' },
  { id: 'two-tone-up', labelKey: 'notifications.sound.twoToneUp' },
  { id: 'pluck', labelKey: 'notifications.sound.pluck' },
];

export const FAILURE_SOUNDS: SoundOption[] = [
  { id: 'buzz', labelKey: 'notifications.sound.buzz' },
  { id: 'two-tone-down', labelKey: 'notifications.sound.twoToneDown' },
  { id: 'thud', labelKey: 'notifications.sound.thud' },
];

export const DEFAULT_SUCCESS_SOUND_ID: SoundId = 'ding';
export const DEFAULT_FAILURE_SOUND_ID: SoundId = 'buzz';

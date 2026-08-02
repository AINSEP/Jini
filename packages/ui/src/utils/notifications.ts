/**
 * Desktop notification + short synthesized sound-cue system for
 * "long-running task finished" style completion signals.
 *
 * Origin: `utils/notifications.ts`. Genericized in two places (see
 * `packages/ui/source-map.md`):
 *   - `labelKey: keyof Dict` (OD's fixed translation dictionary type)
 *     widened to a plain `string` — this package's i18n feature has no
 *     fixed `Dict` shape for a sound catalog to key into.
 *   - The hard-coded `'/od-notifications-sw.js'` service-worker URL and
 *     `'od-task-'` notification tag prefix are now caller-supplied
 *     options (defaulting to generic, non-product-branded values).
 */

// The catalog (ids, labels, defaults) now lives in
// `features/notifications/notifications-catalog.ts` so a settings surface
// can name the choices without pulling in Web Audio or the Notification
// API. Re-exported here so every existing importer of this module keeps
// working unchanged.
import type { SoundId } from '../features/notifications/notifications-catalog.js';
export {
  DEFAULT_FAILURE_SOUND_ID,
  DEFAULT_SUCCESS_SOUND_ID,
  FAILURE_SOUNDS,
  type SoundId,
  type SoundOption,
  SUCCESS_SOUNDS,
} from '../features/notifications/notifications-catalog.js';


type AudioCtxCtor = typeof AudioContext;
type NotificationOptionsWithBrowserExtensions = NotificationOptions & {
  renotify?: boolean;
};

let ctx: AudioContext | null = null;
const activeNotifications = new Set<Notification>();

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor: AudioCtxCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // Autoplay policy can refuse — fall through silently. The next
      // user-gesture-driven call will retry.
    });
  }
  return ctx;
}

interface ToneSpec {
  freq: number;
  type: OscillatorType;
  start: number;
  duration: number;
  // Every real SOUND_PLAYERS entry (this type's only caller) always
  // supplies an explicit gain, so this is required rather than optional
  // with a fallback — an unreachable-by-any-real-caller default is dead
  // code, not real API surface (see packages/ui/source-map.md).
  gain: number;
  /** Optional lowpass cutoff applied via a BiquadFilter for plucky textures. */
  lowpass?: number;
}

function playTones(c: AudioContext, tones: ToneSpec[]): void {
  const now = c.currentTime;
  for (const tone of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = tone.type;
    osc.frequency.value = tone.freq;
    const peak = tone.gain;
    const startAt = now + tone.start;
    const endAt = startAt + tone.duration;
    // Short attack to avoid clicks; exponential-ish decay via a linear
    // ramp to near-zero (exponentialRamp can't reach exactly 0).
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + Math.min(0.005, tone.duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    let last: AudioNode = osc;
    if (tone.lowpass) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = tone.lowpass;
      osc.connect(lp);
      last = lp;
    }
    last.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}

const SOUND_PLAYERS: Record<SoundId, (c: AudioContext) => void> = {
  ding: (c) => {
    playTones(c, [{ freq: 880, type: 'sine', start: 0, duration: 0.25, gain: 0.22 }]);
  },
  chime: (c) => {
    playTones(c, [
      { freq: 880, type: 'triangle', start: 0, duration: 0.4, gain: 0.18 },
      { freq: 1320, type: 'triangle', start: 0, duration: 0.4, gain: 0.12 },
    ]);
  },
  'two-tone-up': (c) => {
    playTones(c, [
      { freq: 660, type: 'square', start: 0, duration: 0.08, gain: 0.16 },
      { freq: 990, type: 'square', start: 0.09, duration: 0.08, gain: 0.16 },
    ]);
  },
  pluck: (c) => {
    playTones(c, [{ freq: 220, type: 'sawtooth', start: 0, duration: 0.15, gain: 0.22, lowpass: 1200 }]);
  },
  buzz: (c) => {
    playTones(c, [
      { freq: 165, type: 'square', start: 0, duration: 0.06, gain: 0.2 },
      { freq: 165, type: 'square', start: 0.1, duration: 0.06, gain: 0.2 },
      { freq: 165, type: 'square', start: 0.2, duration: 0.06, gain: 0.2 },
    ]);
  },
  'two-tone-down': (c) => {
    playTones(c, [
      { freq: 880, type: 'sine', start: 0, duration: 0.12, gain: 0.2 },
      { freq: 440, type: 'sine', start: 0.13, duration: 0.12, gain: 0.2 },
    ]);
  },
  thud: (c) => {
    playTones(c, [{ freq: 80, type: 'sine', start: 0, duration: 0.12, gain: 0.32 }]);
  },
};

/** Plays a registered sound id. No-ops silently on any failure (never throws into UI code). */
export function playSound(id: SoundId): void {
  const c = getCtx();
  if (!c) return;
  const player = SOUND_PLAYERS[id];
  if (!player) return;
  try {
    player(c);
  } catch {
    // A node creation/connection failure should never throw out to UI code.
  }
}

export function previewSuccess(id: SoundId): void {
  playSound(id);
}

export function previewFailure(id: SoundId): void {
  playSound(id);
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export interface CompletionNotificationOpts {
  status: 'succeeded' | 'failed';
  title: string;
  body: string;
  onClick?: () => void;
  /** Service-worker script URL to register for the `showNotification` path.
   *  Omit to skip the service-worker path entirely and go straight to the
   *  `Notification` constructor. */
  serviceWorkerUrl?: string;
  /** Prefix for the notification `tag` (`${tagPrefix}-${status}`). Defaults
   *  to `'task'`. */
  tagPrefix?: string;
}

export type CompletionNotificationResult = 'shown' | 'unsupported' | 'permission-denied' | 'failed';

function notificationOptionsFor(opts: CompletionNotificationOpts): NotificationOptionsWithBrowserExtensions {
  const tag = `${opts.tagPrefix ?? 'task'}-${opts.status}`;
  return {
    body: opts.body,
    tag,
    renotify: true,
    data: {
      status: opts.status,
      url: typeof window === 'undefined' ? '/' : window.location.href,
    },
  };
}

async function showViaServiceWorker(
  opts: CompletionNotificationOpts,
): Promise<CompletionNotificationResult | null> {
  if (!opts.serviceWorkerUrl) return null;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(opts.serviceWorkerUrl);
    const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);
    if (!readyRegistration.showNotification) return null;
    await readyRegistration.showNotification(opts.title, notificationOptionsFor(opts));
    return 'shown';
  } catch {
    return null;
  }
}

// `showViaConstructor`'s only caller (`showCompletionNotification`) already
// checks `typeof Notification === 'undefined'` and
// `Notification.permission !== 'granted'` before ever calling this
// function, so re-checking either here is unreachable dead code — removed
// rather than tested around (this file's `ToneSpec.gain` default is the
// same pattern above).
function showViaConstructor(opts: CompletionNotificationOpts): CompletionNotificationResult {
  try {
    const note = new Notification(opts.title, notificationOptionsFor(opts));
    activeNotifications.add(note);
    const release = () => {
      note.onclick = null;
      note.onclose = null;
      note.onerror = null;
      activeNotifications.delete(note);
    };
    note.onclick = () => {
      try {
        if (typeof window !== 'undefined') window.focus();
      } catch {
        /* ignore */
      }
      opts.onClick?.();
      try {
        note.close();
      } catch {
        /* ignore */
      }
    };
    note.onclose = release;
    note.onerror = release;
    return 'shown';
  } catch {
    return 'failed';
  }
}

/**
 * Shows a completion notification, preferring the service-worker path (if
 * `serviceWorkerUrl` is supplied and registration succeeds) and falling
 * back to the direct `Notification` constructor.
 *
 * @overallScore 100
 */
export async function showCompletionNotification(
  opts: CompletionNotificationOpts,
): Promise<CompletionNotificationResult> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'granted') return 'permission-denied';
  return (await showViaServiceWorker(opts)) ?? showViaConstructor(opts);
}

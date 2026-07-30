// @vitest-environment node
//
// Runs under plain Node (no jsdom) rather than this package's jsdom
// default, deliberately: several branches in notifications.ts key off
// `typeof window === 'undefined'` / `typeof navigator === 'undefined'`,
// which only hold with no DOM globals at all — jsdom always defines both.
// Node's own built-in `navigator` (UA-string only, no `serviceWorker`)
// conveniently mirrors jsdom's default shape for the branches that need
// `navigator` present but featureless. Every "window/document present"
// case builds its own minimal hand-built global via `vi.stubGlobal`
// instead of switching environments, which avoids a real
// `@vitest/coverage-v8` limitation this package has already hit once:
// splitting one source file's tests across a jsdom file and a
// `// @vitest-environment node` companion file loses branch-hit merging
// across the two instrumented instances (see this file's
// `features/html-viewer/dependencies` precedent in
// packages/ui/source-map.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAILURE_SOUND_ID,
  DEFAULT_SUCCESS_SOUND_ID,
  notificationPermission,
  playSound,
  previewFailure,
  previewSuccess,
  requestNotificationPermission,
  showCompletionNotification,
} from '../notifications.js';

// notifications.ts caches its AudioContext at module scope (the origin's
// own singleton reuse pattern). Each of the following cases stubs a
// differently-shaped fake AudioContext, so each gets a fresh module
// instance via resetModules — otherwise a later test would silently reuse
// an earlier test's cached instance.
async function freshModule() {
  vi.resetModules();
  return import('../notifications.js');
}

function fakeOscillatorNode() {
  return { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
}

function fakeGainNode() {
  return {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  };
}

describe('playSound / previewSuccess / previewFailure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops without throwing when window is absent (Node default, no DOM at all)', () => {
    expect(() => playSound(DEFAULT_SUCCESS_SOUND_ID)).not.toThrow();
    expect(() => previewSuccess(DEFAULT_SUCCESS_SOUND_ID)).not.toThrow();
    expect(() => previewFailure(DEFAULT_FAILURE_SOUND_ID)).not.toThrow();
  });

  it('no-ops when window exists but neither AudioContext nor webkitAudioContext is available', async () => {
    vi.stubGlobal('window', {});
    const { playSound: freshPlaySound } = await freshModule();
    expect(() => freshPlaySound(DEFAULT_SUCCESS_SOUND_ID)).not.toThrow();
  });

  it('falls back to webkitAudioContext when AudioContext is absent', async () => {
    const start = vi.fn();
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      createOscillator = fakeOscillatorNode;
      createGain = fakeGainNode;
      destination = {};
      constructor() {
        // Route through a distinguishable start spy so the test can prove
        // this constructor (not some other) actually ran.
        this.createOscillator = () => ({ ...fakeOscillatorNode(), start });
      }
    }
    vi.stubGlobal('window', { webkitAudioContext: FakeAudioContext });
    const { playSound: freshPlaySound } = await freshModule();
    freshPlaySound(DEFAULT_SUCCESS_SOUND_ID);
    expect(start).toHaveBeenCalled();
  });

  it('no-ops when constructing the AudioContext throws', async () => {
    class ThrowingAudioContext {
      constructor() {
        throw new Error('denied by browser policy');
      }
    }
    vi.stubGlobal('window', { AudioContext: ThrowingAudioContext });
    const { playSound: freshPlaySound } = await freshModule();
    expect(() => freshPlaySound(DEFAULT_SUCCESS_SOUND_ID)).not.toThrow();
  });

  it('resumes a suspended AudioContext before playing', async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn();
    class FakeAudioContext {
      state = 'suspended';
      currentTime = 0;
      resume = resume;
      createOscillator() {
        return { ...fakeOscillatorNode(), start };
      }
      createGain = fakeGainNode;
      destination = {};
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const { playSound: freshPlaySound } = await freshModule();
    freshPlaySound(DEFAULT_SUCCESS_SOUND_ID);
    expect(resume).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('swallows a rejected resume() on a suspended AudioContext without throwing', async () => {
    class FakeAudioContext {
      state = 'suspended';
      currentTime = 0;
      resume = vi.fn().mockRejectedValue(new Error('autoplay policy refused'));
      createOscillator = fakeOscillatorNode;
      createGain = fakeGainNode;
      destination = {};
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const { playSound: freshPlaySound } = await freshModule();
    expect(() => freshPlaySound(DEFAULT_SUCCESS_SOUND_ID)).not.toThrow();
    // Let the rejected promise's .catch() microtask actually run before the
    // test file's teardown, so the rejection is truly observed as handled.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('no-ops for an unknown sound id even with an AudioContext available', async () => {
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      createOscillator = fakeOscillatorNode;
      createGain = fakeGainNode;
      destination = {};
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const { playSound: freshPlaySound } = await freshModule();
    expect(() => freshPlaySound('not-a-real-sound')).not.toThrow();
  });

  it('drives oscillator + gain node wiring for every registered sound id without throwing', async () => {
    const connect = vi.fn();
    const start = vi.fn();
    const stop = vi.fn();
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect, start, stop };
      }
      createBiquadFilter() {
        return { type: '', frequency: { value: 0 }, connect };
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect,
        };
      }
      destination = {};
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const { playSound: freshPlaySound } = await freshModule();

    // Exercises every SOUND_PLAYERS entry — including the multi-tone
    // players and pluck's lowpass-filter branch — so every sound-id
    // closure body runs at least once.
    for (const id of ['ding', 'chime', 'two-tone-up', 'pluck', 'buzz', 'two-tone-down', 'thud']) {
      freshPlaySound(id);
    }

    expect(start).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
  });

  it('swallows a node-creation failure inside a sound player without throwing', async () => {
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      createOscillator(): never {
        throw new Error('node creation failed');
      }
      createGain = fakeGainNode;
      destination = {};
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const { playSound: freshPlaySound } = await freshModule();
    expect(() => freshPlaySound(DEFAULT_SUCCESS_SOUND_ID)).not.toThrow();
  });
});

describe('notificationPermission / requestNotificationPermission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported when the Notification API is absent (Node default)', async () => {
    expect(notificationPermission()).toBe('unsupported');
    await expect(requestNotificationPermission()).resolves.toBe('unsupported');
  });

  it('returns the current permission without prompting when already decided', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    expect(notificationPermission()).toBe('granted');
    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect((globalThis as { Notification: { requestPermission: () => void } }).Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('prompts when permission is still "default"', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalled();
  });

  it('resolves to "denied" when requesting permission throws/rejects', async () => {
    const requestPermission = vi.fn().mockRejectedValue(new Error('user dismissed'));
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    await expect(requestNotificationPermission()).resolves.toBe('denied');
  });
});

describe('showCompletionNotification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeNotificationClass(overrides: Partial<{ constructorThrows: boolean; close: () => void }> = {}) {
    return class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      title: string;
      options: NotificationOptions | undefined;
      constructor(title: string, options?: NotificationOptions) {
        if (overrides.constructorThrows) throw new Error('blocked');
        this.title = title;
        this.options = options;
      }
      close() {
        overrides.close?.();
      }
    };
  }

  it('returns unsupported without a Notification global', async () => {
    const result = await showCompletionNotification({ status: 'succeeded', title: 't', body: 'b' });
    expect(result).toBe('unsupported');
  });

  it('returns permission-denied when permission is not granted', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    const result = await showCompletionNotification({ status: 'failed', title: 't', body: 'b' });
    expect(result).toBe('permission-denied');
  });

  it('returns failed when the Notification constructor itself throws', async () => {
    vi.stubGlobal('Notification', fakeNotificationClass({ constructorThrows: true }));
    const result = await showCompletionNotification({ status: 'succeeded', title: 't', body: 'b' });
    expect(result).toBe('failed');
  });

  it('shows via the Notification constructor with the default tag prefix and no window (SSR-style url fallback)', async () => {
    const NotificationClass = fakeNotificationClass();
    vi.stubGlobal('Notification', NotificationClass);

    const result = await showCompletionNotification({ status: 'succeeded', title: 'Done', body: 'All good' });

    expect(result).toBe('shown');
  });

  it('honors a custom tagPrefix and uses window.location.href for the notification data url when window is present', async () => {
    let lastOptions: (NotificationOptions & { data?: { url?: string } }) | undefined;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_title: string, options?: NotificationOptions) {
        lastOptions = options as NotificationOptions & { data?: { url?: string } };
      }
      close() {
        /* no-op */
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('window', { location: { href: 'https://example.test/run/1' } });

    await showCompletionNotification({
      status: 'failed',
      title: 'Failed',
      body: 'oops',
      tagPrefix: 'my-app',
    });

    expect(lastOptions?.tag).toBe('my-app-failed');
    expect(lastOptions?.data?.url).toBe('https://example.test/run/1');
  });

  it('runs the onclick handler: focuses window, invokes onClick, and closes the notification', async () => {
    const focus = vi.fn();
    const close = vi.fn();
    let created: InstanceType<ReturnType<typeof fakeNotificationClass>> | undefined;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(
        public title: string,
        public options?: NotificationOptions,
      ) {
        created = this as unknown as InstanceType<ReturnType<typeof fakeNotificationClass>>;
      }
      close = close;
    }
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('window', { focus, location: { href: 'https://example.test/run/1' } });
    const onClick = vi.fn();

    await showCompletionNotification({ status: 'succeeded', title: 'Done', body: 'ok', onClick });

    expect(created?.onclick).toBeTypeOf('function');
    created?.onclick?.();

    expect(focus).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('runs the onclick handler without throwing when window.focus throws, onClick is omitted, and close() throws', async () => {
    let created: { onclick: (() => void) | null; close: () => void } | undefined;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        created = this as unknown as typeof created;
      }
      close() {
        throw new Error('already closed');
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('window', {
      focus: () => {
        throw new Error('cannot focus');
      },
      location: { href: 'https://example.test/run/1' },
    });

    await showCompletionNotification({ status: 'succeeded', title: 'Done', body: 'ok' });
    expect(created?.onclick).toBeTypeOf('function');
    expect(() => created?.onclick?.()).not.toThrow();
  });

  it('releases handlers via onclose (clearing onclick/onclose/onerror)', async () => {
    let created: { onclick: unknown; onclose: (() => void) | null; onerror: unknown } | undefined;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        created = this;
      }
      close() {
        /* no-op */
      }
    }
    vi.stubGlobal('Notification', FakeNotification);

    await showCompletionNotification({ status: 'succeeded', title: 'Done', body: 'ok' });

    expect(created?.onclose).toBeTypeOf('function');
    created?.onclose?.();
    expect(created?.onclick).toBeNull();
    expect(created?.onclose).toBeNull();
    expect(created?.onerror).toBeNull();
  });

  it('releases handlers via onerror too', async () => {
    let created: { onerror: (() => void) | null } | undefined;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        created = this;
      }
      close() {
        /* no-op */
      }
    }
    vi.stubGlobal('Notification', FakeNotification);

    await showCompletionNotification({ status: 'succeeded', title: 'Done', body: 'ok' });
    created?.onerror?.();
    expect(created?.onerror).toBeNull();
  });

  it('falls back to the constructor when the service worker path is unavailable (default, featureless navigator)', async () => {
    vi.stubGlobal('Notification', fakeNotificationClass());

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Done',
      body: 'ok',
      serviceWorkerUrl: '/sw.js',
    });

    // Node's built-in `navigator` (like jsdom's) has no `serviceWorker`
    // property, so the SW path returns null and falls through to the
    // constructor path.
    expect(result).toBe('shown');
  });

  it('falls back to the constructor when navigator itself is entirely absent', async () => {
    vi.stubGlobal('Notification', fakeNotificationClass());
    vi.stubGlobal('navigator', undefined);

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Done',
      body: 'ok',
      serviceWorkerUrl: '/sw.js',
    });

    expect(result).toBe('shown');
  });

  it('shows via the service worker registration when available', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const registration = { showNotification };
    vi.stubGlobal('Notification', fakeNotificationClass());
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Done',
      body: 'ok',
      serviceWorkerUrl: '/sw.js',
    });

    expect(result).toBe('shown');
    expect(showNotification).toHaveBeenCalledWith('Done', expect.objectContaining({ tag: 'task-succeeded' }));
  });

  it('falls back to the constructor when the ready registration has no showNotification', async () => {
    const registration = {};
    vi.stubGlobal('Notification', fakeNotificationClass());
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Done',
      body: 'ok',
      serviceWorkerUrl: '/sw.js',
    });

    expect(result).toBe('shown');
  });

  it('falls back to the initial registration when navigator.serviceWorker.ready rejects', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const registration = { showNotification };
    vi.stubGlobal('Notification', fakeNotificationClass());
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.reject(new Error('never ready')),
      },
    });

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Done',
      body: 'ok',
      serviceWorkerUrl: '/sw.js',
    });

    expect(result).toBe('shown');
    expect(showNotification).toHaveBeenCalled();
  });

  it('falls back to the constructor when navigator.serviceWorker.register throws', async () => {
    vi.stubGlobal('Notification', fakeNotificationClass());
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn().mockRejectedValue(new Error('registration failed')),
        ready: Promise.resolve({}),
      },
    });

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Done',
      body: 'ok',
      serviceWorkerUrl: '/sw.js',
    });

    expect(result).toBe('shown');
  });
});

/**
 * The updater lifecycle through fake ports: when a controller starts, what turning the preference
 * OFF/ON does to the controller and the native updater, how the final quit is decided, and the
 * manual check's loader. Host copy (log wording, the skip policy) is tested by the host.
 */
import { describe, expect, it } from 'vitest';
import { createDesktopUpdater, createDesktopUpdaterState } from '../desktop-updater.js';
import type { DesktopNativeUpdater, DesktopUpdaterPorts } from '../desktop-updater.js';
import type { AutoUpdateController } from '../auto-update-controller.js';

type Native = DesktopNativeUpdater & { id: number };
let nextId = 0;
const fakeNative = (): Native => ({ id: ++nextId, autoDownload: true, autoInstallOnAppQuit: true });

/** A controller that records calls; `held` is what beforeFinalQuit answers. */
function fakeController(calls: string[], { held = false }: { held?: boolean } = {}): AutoUpdateController {
  return {
    start: () => { calls.push('start'); },
    tick() {},
    requestRestart: () => { calls.push('requestRestart'); },
    beforeFinalQuit: () => { calls.push('beforeFinalQuit'); return held; },
    willQuit: () => { calls.push('willQuit'); },
  };
}

type Created = Parameters<DesktopUpdaterPorts<Native>['createController']>[0];

function harness({
  automatic = true, skip = null, idle = true, prompt = true, held = false, load, saveFails = false,
}: {
  automatic?: boolean; skip?: string | null; idle?: boolean; prompt?: boolean; held?: boolean;
  load?: () => Promise<Native>; saveFails?: boolean;
} = {}) {
  const calls: string[] = [];
  const skipped: string[] = [];
  const failures: unknown[] = [];
  const native = fakeNative();
  const automaticRef = { value: automatic };
  const created: Created[] = [];
  const ports: DesktopUpdaterPorts<Native> = {
    automaticUpdates: () => automaticRef.value,
    saveAutomaticUpdates: ({ enabled }) => {
      if (saveFails) throw new Error('disk full');
      calls.push(`save:${enabled}`);
      automaticRef.value = enabled;
    },
    skipReason: () => skip,
    loadNativeUpdater: load ?? (async () => { calls.push('load'); return native; }),
    quitIdle: () => idle,
    createController: args => {
      created.push(args);
      calls.push('create');
      return fakeController(calls, { held });
    },
    promptUpdateReady: async ({ version }) => { calls.push(`prompt:${version}`); return prompt; },
    reporter: {
      skipped: ({ reason }) => { skipped.push(reason); },
      startFailed: ({ error }) => { failures.push(error); },
    },
  };
  const updater = createDesktopUpdater({ ports });
  return { calls, skipped, failures, native, automatic: automaticRef, created, updater, ports };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('starting the updater', () => {
  it('an eligible launch loads the native updater, binds a controller to it and starts it', async () => {
    const h = harness();
    await h.updater.start();
    expect(h.calls).toEqual(['load', 'create', 'start']);
    expect(h.created[0]!.updater).toBe(h.native);
    expect(h.updater.state.native).toBe(h.native);
    expect(h.updater.state.starting).toBe(false);
  });

  it('a skipped launch reports the policy reason and never loads the native updater', async () => {
    const h = harness({ skip: 'self-test launch' });
    await h.updater.start();
    expect(h.calls).toEqual([]);
    expect(h.skipped).toEqual(['self-test launch']);
    expect(h.updater.state.starting).toBe(false);
  });

  it('a persisted OFF choice skips lazy updater loading on launch', async () => {
    const h = harness({ automatic: false });
    await h.updater.start();
    expect(h.calls).toEqual([]);
    expect(h.skipped).toEqual([]);
  });

  it('turning updates OFF while the native updater is loading creates no controller', async () => {
    let release!: (value: Native) => void;
    const h = harness({ load: () => new Promise(resolve => { release = resolve; }) });
    const starting = h.updater.start();
    h.automatic.value = false;
    release(fakeNative());
    await starting;
    expect(h.calls).toEqual([]);
    expect(h.updater.state.controller).toBeNull();
    expect(h.updater.state.starting).toBe(false);
  });

  it('a quit drain that began during the load creates no controller', async () => {
    const h = harness({ idle: false });
    await h.updater.start();
    expect(h.calls).toEqual(['load']);
    expect(h.updater.state.controller).toBeNull();
  });

  it('concurrent updater starts wait for one controller to be listening', async () => {
    let release!: (value: Native) => void;
    const h = harness({ load: () => new Promise(resolve => { release = resolve; }) });
    const first = h.updater.start();
    let secondReady = false;
    const second = h.updater.start().then(() => { secondReady = true; });
    await settle();
    expect(secondReady).toBe(false);
    release(fakeNative());
    await Promise.all([first, second]);
    await h.updater.start();
    expect(h.calls).toEqual(['create', 'start']);
  });

  it('a failed load clears the starting flag, so a later start can retry', async () => {
    let fail = true;
    const h = harness({ load: async () => { if (fail) throw new Error('offline'); return fakeNative(); } });
    await expect(h.updater.start()).rejects.toThrow(/offline/);
    expect(h.updater.state.starting).toBe(false);
    fail = false;
    await h.updater.start();
    expect(h.calls).toEqual(['create', 'start']);
  });

  it('a background start reports a rejection instead of failing the boot', async () => {
    const error = new Error('updater unavailable');
    const h = harness({ load: async () => { throw error; } });
    h.updater.startInBackground();
    await settle();
    expect(h.failures).toEqual([error]);
  });

  it('a non-Error rejection reaches the reporter unchanged', async () => {
    const h = harness({ load: () => Promise.reject('gone') });
    h.updater.startInBackground();
    await settle();
    expect(h.failures).toEqual(['gone']);
  });

  it('the controller factory runs at start, not when the updater is created', async () => {
    const h = harness();
    expect(h.created).toEqual([]);
    await h.updater.start();
    expect(h.created).toHaveLength(1);
  });
});

describe('the ready version', () => {
  it("the controller's download prompt records the ready version for a manual check", async () => {
    const h = harness({ prompt: false });
    await h.updater.start();
    expect(h.updater.readyVersion()).toBeNull();
    expect(await h.created[0]!.promptUpdateReady({ version: '3.1.0' })).toBe(false);
    expect(h.updater.readyVersion()).toBe('3.1.0');
    expect(h.calls).toContain('prompt:3.1.0');
  });

  it('a ready version is not offered once the controller is gone', async () => {
    const h = harness();
    await h.updater.start();
    await h.created[0]!.promptUpdateReady({ version: '3.1.0' });
    h.updater.setAutomaticUpdates({ enabled: false });
    expect(h.updater.readyVersion()).toBeNull();
  });

  it('a restart starts the controller fresh: an old ready version is forgotten', async () => {
    const state = createDesktopUpdaterState<Native>();
    state.readyVersion = '0.9.0';
    const { ports } = harness();
    const updater = createDesktopUpdater({ ports }, { state });
    await updater.start();
    expect(updater.state).toBe(state);
    expect(state.readyVersion).toBeNull();
  });
});

describe('the automatic-updates preference', () => {
  it('turning automatic updates OFF persists first, stops the coordinator, and disables native installs/downloads', async () => {
    const h = harness();
    await h.updater.start();
    h.calls.length = 0;
    h.updater.setAutomaticUpdates({ enabled: false });
    expect(h.calls).toEqual(['save:false', 'willQuit']);
    expect(h.updater.state.controller).toBeNull();
    expect(h.native.autoDownload).toBe(false);
    expect(h.native.autoInstallOnAppQuit).toBe(false);
  });

  it('turning updates OFF before any native updater loaded only persists', () => {
    const h = harness();
    h.updater.setAutomaticUpdates({ enabled: false });
    expect(h.calls).toEqual(['save:false']);
    expect(h.updater.state.native).toBeNull();
  });

  it('a failed preference save does not shut down an enabled updater', async () => {
    const h = harness({ saveFails: true });
    await h.updater.start();
    const controller = h.updater.state.controller;
    h.calls.length = 0;
    expect(() => h.updater.setAutomaticUpdates({ enabled: false })).toThrow(/disk full/);
    expect(h.calls).toEqual([]);
    expect(h.updater.state.controller).toBe(controller);
    expect(h.native.autoDownload).toBe(true);
    expect(h.native.autoInstallOnAppQuit).toBe(true);
  });

  it('a failed save of ON starts nothing', () => {
    const h = harness({ automatic: false, saveFails: true });
    expect(() => h.updater.setAutomaticUpdates({ enabled: true })).toThrow(/disk full/);
    expect(h.calls).toEqual([]);
  });

  it('turning automatic updates back ON starts the eligible updater after saving', async () => {
    const h = harness({ automatic: false });
    h.updater.setAutomaticUpdates({ enabled: true });
    await settle();
    expect(h.calls).toEqual(['save:true', 'load', 'create', 'start']);
  });
});

describe('the final quit (quit after a downloaded update)', () => {
  it('the final quit asks the controller and is held exactly when it says so', async () => {
    for (const held of [true, false]) {
      const h = harness({ held });
      await h.updater.start();
      expect(h.updater.finalQuitHeldForUpdate()).toBe(held);
      expect(h.calls).toContain('beforeFinalQuit');
    }
  });

  it('with no controller the final quit is never held', () => {
    expect(harness().updater.finalQuitHeldForUpdate()).toBe(false);
  });

  it('a persisted OFF choice suppresses installation of an already downloaded update on final quit', async () => {
    const h = harness();
    await h.updater.start();
    h.automatic.value = false;
    h.calls.length = 0;
    expect(h.updater.finalQuitHeldForUpdate()).toBe(false);
    expect(h.calls, 'the controller must not be asked to install').toEqual([]);
    expect(h.native.autoInstallOnAppQuit).toBe(false);
  });

  it('OFF at final quit with no native updater loaded is simply not held', () => {
    const h = harness({ automatic: false });
    expect(h.updater.finalQuitHeldForUpdate()).toBe(false);
    expect(h.updater.state.native).toBeNull();
  });

  it("will-quit removes this instance's presence record only when a controller runs", async () => {
    const h = harness();
    h.updater.willQuit();
    expect(h.calls).toEqual([]);
    await h.updater.start();
    h.updater.willQuit();
    expect(h.calls.at(-1)).toBe('willQuit');
  });
});

describe('the manual check (no duplicate loads)', () => {
  it('a manual check waits for an in-flight automatic startup before returning the updater', async () => {
    let release!: (value: Native) => void;
    const loading = new Promise<Native>(resolve => { release = resolve; });
    let loads = 0;
    const h = harness({ load: () => ++loads === 1 ? loading : Promise.resolve(fakeNative()) });
    const starting = h.updater.start();
    let ready = false;
    const checking = h.updater.loadUpdaterForCheck().then(() => {
      expect(h.updater.state.controller).not.toBeNull();
      ready = true;
    });
    await settle();
    expect(ready).toBe(false);
    expect(loads, 'manual check cannot race the lazy import').toBe(1);
    release(fakeNative());
    await Promise.all([starting, checking]);
    expect(ready).toBe(true);
  });

  it('a manual check with updates ON starts the controller before handing back the native updater', async () => {
    const h = harness();
    const updater = await h.updater.loadUpdaterForCheck();
    expect(updater).toBe(h.native);
    expect(h.calls).toEqual(['load', 'create', 'start', 'load']);
  });

  it('a manual check with updates OFF only loads the native updater and remembers it', async () => {
    const h = harness({ automatic: false });
    const updater = await h.updater.loadUpdaterForCheck();
    expect(updater).toBe(h.native);
    expect(h.calls).toEqual(['load']);
    expect(h.updater.state.native).toBe(h.native);
    expect(h.updater.state.controller).toBeNull();
  });

  it('a later check keeps the native updater the controller already listens to', async () => {
    const first = fakeNative();
    const other = fakeNative();
    const natives = [first, other];
    const h = harness({ load: async () => natives.shift()! });
    await h.updater.start();
    h.automatic.value = false;
    expect(await h.updater.loadUpdaterForCheck()).toBe(other);
    expect(h.updater.state.native).toBe(first);
  });

  it('the ready prompt restarts through the controller only when Restart is chosen', async () => {
    for (const prompt of [true, false]) {
      const h = harness({ prompt });
      await h.updater.start();
      await h.updater.showReadyPrompt({ version: '4.0.0' });
      expect(h.calls.includes('requestRestart')).toBe(prompt);
      expect(h.calls).toContain('prompt:4.0.0');
    }
  });

  it('a Restart choice with no controller running does nothing further', async () => {
    const h = harness({ prompt: true });
    await h.updater.showReadyPrompt({ version: '4.0.0' });
    expect(h.calls).toEqual(['prompt:4.0.0']);
  });
});

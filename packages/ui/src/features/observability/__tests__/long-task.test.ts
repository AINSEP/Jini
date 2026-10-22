import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ObserverCallback = (list: { getEntries: () => unknown[] }) => void;

class FakePerformanceObserver {
  static supportedEntryTypes: readonly string[] = ['longtask'];
  static instances: FakePerformanceObserver[] = [];
  callback: ObserverCallback;
  observed: unknown[] = [];
  disconnected = false;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    FakePerformanceObserver.instances.push(this);
  }

  observe(options: unknown): void {
    this.observed.push(options);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(entries: unknown[]): void {
    this.callback({ getEntries: () => entries });
  }
}

async function freshModule() {
  vi.resetModules();
  return import('../long-task.js');
}

describe('installLongTaskObserver', () => {
  beforeEach(() => {
    FakePerformanceObserver.instances = [];
    FakePerformanceObserver.supportedEntryTypes = ['longtask'];
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver as unknown as typeof PerformanceObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports entries at or above the duration threshold, and skips shorter ones', async () => {
    const { installLongTaskObserver } = await freshModule();
    const reporter = vi.fn();
    installLongTaskObserver({ reporter });

    const [instance] = FakePerformanceObserver.instances;
    instance!.emit([
      { duration: 250, startTime: 10 },
      { duration: 40, startTime: 20 }, // below default 100ms threshold
    ]);

    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(
      'client_long_task',
      expect.objectContaining({ duration_ms: 250, start_time_ms: 10 }),
    );
  });

  it('honors a custom minDurationMs', async () => {
    const { installLongTaskObserver } = await freshModule();
    const reporter = vi.fn();
    installLongTaskObserver({ reporter, minDurationMs: 10 });

    const [instance] = FakePerformanceObserver.instances;
    instance!.emit([{ duration: 15, startTime: 0 }]);

    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it('includes attribution fields, stripping query strings from containerSrc', async () => {
    const { installLongTaskObserver } = await freshModule();
    const reporter = vi.fn();
    installLongTaskObserver({ reporter });

    const [instance] = FakePerformanceObserver.instances;
    instance!.emit([
      {
        duration: 200,
        startTime: 5,
        attribution: [
          { containerType: 'iframe', containerName: 'preview', containerSrc: 'https://a.test/x?y=1' },
        ],
      },
    ]);

    expect(reporter).toHaveBeenCalledWith(
      'client_long_task',
      expect.objectContaining({
        container_type: 'iframe',
        container_name: 'preview',
        container_src_origin: 'https://a.test/x',
      }),
    );
  });

  it('no-ops without reporting when PerformanceObserver is unsupported', async () => {
    FakePerformanceObserver.supportedEntryTypes = [];
    const { installLongTaskObserver } = await freshModule();
    const teardown = installLongTaskObserver();
    expect(FakePerformanceObserver.instances).toHaveLength(0);
    expect(() => teardown()).not.toThrow();
  });

  it('disconnects the observer on teardown', async () => {
    const { installLongTaskObserver } = await freshModule();
    const teardown = installLongTaskObserver();
    const [instance] = FakePerformanceObserver.instances;
    teardown();
    expect(instance!.disconnected).toBe(true);
  });

  it('defaults to a no-op reporter when none is supplied', async () => {
    const { installLongTaskObserver } = await freshModule();
    expect(() => {
      installLongTaskObserver();
      const [instance] = FakePerformanceObserver.instances;
      instance!.emit([{ duration: 999, startTime: 0 }]);
    }).not.toThrow();
  });

  it('no-ops without reporting when PerformanceObserver is entirely unavailable', async () => {
    vi.unstubAllGlobals();
    const original = globalThis.PerformanceObserver;
    // @ts-expect-error -- simulate an environment without PerformanceObserver
    delete globalThis.PerformanceObserver;
    try {
      const { installLongTaskObserver } = await freshModule();
      const teardown = installLongTaskObserver();
      expect(() => teardown()).not.toThrow();
    } finally {
      globalThis.PerformanceObserver = original;
    }
  });

  it('a second install call reuses the existing observer and its teardown disconnects it', async () => {
    const { installLongTaskObserver } = await freshModule();
    const firstTeardown = installLongTaskObserver();
    const secondTeardown = installLongTaskObserver();
    expect(FakePerformanceObserver.instances).toHaveLength(1);

    secondTeardown();
    expect(FakePerformanceObserver.instances[0]!.disconnected).toBe(true);
    firstTeardown();
  });

  it('falls back to observing without buffered when the buffered observe() call throws', async () => {
    class ThrowsOnBufferedObserver extends FakePerformanceObserver {
      override observe(options: { buffered?: boolean }): void {
        if (options?.buffered) throw new Error('buffered unsupported');
        super.observe(options);
      }
    }
    vi.stubGlobal('PerformanceObserver', ThrowsOnBufferedObserver as unknown as typeof PerformanceObserver);
    const { installLongTaskObserver } = await freshModule();
    expect(() => installLongTaskObserver()).not.toThrow();
    expect(FakePerformanceObserver.instances[0]!.observed).toEqual([{ type: 'longtask' }]);
  });

  it('gives up cleanly (no-op teardown) when both the buffered and plain observe() calls throw', async () => {
    class AlwaysThrowsObserver extends FakePerformanceObserver {
      override observe(): void {
        throw new Error('longtask unsupported at all');
      }
    }
    vi.stubGlobal('PerformanceObserver', AlwaysThrowsObserver as unknown as typeof PerformanceObserver);
    const { installLongTaskObserver } = await freshModule();
    const teardown = installLongTaskObserver();
    expect(() => teardown()).not.toThrow();

    // A subsequent install call must not think an observer is already
    // installed (it was reset to null on the double failure above).
    const secondTeardown = installLongTaskObserver();
    expect(() => secondTeardown()).not.toThrow();
  });

  it('omits an unparseable containerSrc without throwing', async () => {
    const { installLongTaskObserver } = await freshModule();
    const reporter = vi.fn();
    installLongTaskObserver({ reporter });

    const [instance] = FakePerformanceObserver.instances;
    instance!.emit([
      {
        duration: 200,
        startTime: 5,
        attribution: [{ containerSrc: 'not a valid url::::' }],
      },
    ]);

    expect(reporter).toHaveBeenCalledWith(
      'client_long_task',
      expect.objectContaining({ container_src_origin: undefined }),
    );
  });
});

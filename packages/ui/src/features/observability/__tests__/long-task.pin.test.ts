import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EntryList = Pick<PerformanceObserverEntryList, 'getEntries'>;

class ObserverFake implements Pick<PerformanceObserver, 'observe' | 'disconnect'> {
  static supportedEntryTypes = ['longtask'];
  static instances: ObserverFake[] = [];
  static failures = 0;
  attempts: PerformanceObserverInit[] = [];
  disconnect = vi.fn<() => void>();

  constructor(readonly callback: (list: EntryList) => void) {
    ObserverFake.instances.push(this);
  }

  observe(options: PerformanceObserverInit = {}): void {
    this.attempts.push(options);
    if (this.attempts.length <= ObserverFake.failures) throw new Error('unsupported');
  }
}

describe('long-task compatibility pins', () => {
  beforeEach(() => {
    vi.resetModules();
    ObserverFake.instances = [];
    ObserverFake.failures = 0;
    vi.stubGlobal('PerformanceObserver', ObserverFake);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([0, 1, 2])('preserves observation ordering and cleanup after %i failures', async (failures) => {
    ObserverFake.failures = failures;
    const { installLongTaskObserver } = await import('../long-task.js');
    const teardown = installLongTaskObserver();
    const instance = ObserverFake.instances[0]!;
    const attempts = [{ type: 'longtask', buffered: true }, { type: 'longtask' }];
    expect(instance.attempts).toEqual(attempts.slice(0, Math.min(failures + 1, 2)));
    teardown();
    expect(instance.disconnect).toHaveBeenCalledTimes(failures === 2 ? 0 : 1);
    installLongTaskObserver()();
    expect(ObserverFake.instances).toHaveLength(2);
  });

  it.each([
    { supportedEntryTypes: undefined },
    { supportedEntryTypes: { includes: undefined } },
    { supportedEntryTypes: [] },
  ])('ignores missing or unsupported entry-type APIs: $supportedEntryTypes', async ({ supportedEntryTypes }) => {
    vi.stubGlobal('PerformanceObserver', { supportedEntryTypes });
    const { installLongTaskObserver } = await import('../long-task.js');
    installLongTaskObserver()();
    expect(ObserverFake.instances).toHaveLength(0);
  });

  it('duplicate teardown leaves the disconnected observer installed (reported, not fixed)', async () => {
    const { installLongTaskObserver } = await import('../long-task.js');
    const ownerTeardown = installLongTaskObserver();
    installLongTaskObserver()();
    installLongTaskObserver()();
    expect(ObserverFake.instances).toHaveLength(1);
    expect(ObserverFake.instances[0]!.disconnect).toHaveBeenCalledTimes(2);
    ownerTeardown();
  });

  it('reports relative attribution URLs with their query intact (reported, not fixed)', async () => {
    const { installLongTaskObserver } = await import('../long-task.js');
    const reporter = vi.fn();
    const teardown = installLongTaskObserver({ reporter });
    const entry: PerformanceEntry & { attribution: Array<{ containerSrc: string }> } = {
      name: 'self', entryType: 'longtask', duration: 100, startTime: 1,
      attribution: [{ containerSrc: '/frame?token=secret' }], toJSON: () => ({}),
    };
    ObserverFake.instances[0]!.callback({ getEntries: () => [entry] });
    expect(reporter.mock.calls).toEqual([['client_long_task', {
      duration_ms: 100, start_time_ms: 1, container_type: undefined,
      container_name: undefined, container_src_origin: '/frame?token=secret',
    }]]);
    teardown();
  });
});

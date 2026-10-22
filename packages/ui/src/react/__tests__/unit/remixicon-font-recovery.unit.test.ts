import { describe, expect, it } from 'vitest';
import {
  startRemixIconFontRecovery,
  type FontRetryTimers,
  type RemixIconFontSet,
} from '../../components/remixicon-font-recovery.js';

/** Manual clock: retry deadlines advance only when the test explicitly fires them. */
class FakeTimers implements FontRetryTimers {
  pending = new Map<number, { run: () => void; delay: number }>();
  delays: number[] = [];
  nextId = 0;
  setTimeout(run: () => void, delay: number): number {
    const id = ++this.nextId;
    this.pending.set(id, { run, delay });
    this.delays.push(delay);
    return id;
  }
  clearTimeout(id: unknown): void { this.pending.delete(id as number); }
  fire(): void {
    const [id, task] = this.pending.entries().next().value!;
    this.pending.delete(id);
    task.run();
  }
}

/** A loaded face has no effect on rendering until it is added to the document's font set. */
function fakeFontSet({ initial = 'failure' }: { initial?: 'failure' | 'success' | 'unchecked' | 'missing' } = {}) {
  const loaded = { family: 'remixicon', status: 'loaded' } as FontFace;
  const applied: FontFace[] = [];
  const requests: Array<[string, string | undefined]> = [];
  const fonts: RemixIconFontSet = {
    async load(font, text) {
      requests.push([font, text]);
      if (initial === 'failure') throw new Error('dev server restarting');
      if (initial === 'missing') return [];
      return [loaded];
    },
    check: () => initial === 'success' || initial === 'missing',
    add(face) { applied.push(face); },
  };
  return { fonts, loaded, applied, requests };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('RemixIcon font recovery (fontretry)', () => {
  it('retries failed loads with backoff and applies only the successful fresh face', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    const attempts: number[] = [];
    startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace({ attempt }) {
      attempts.push(attempt);
      return { async load() {
        if (attempt < 3) throw new Error('still offline');
        return set.loaded;
      } };
    } });
    await settle();
    expect(set.requests).toEqual([['16px "remixicon"', '\uea01']]);
    expect(timers.delays).toEqual([1000]);
    expect(set.applied).toEqual([]);
    timers.fire(); await settle();
    timers.fire(); await settle();
    expect(timers.delays).toEqual([1000, 3000, 10000]);
    expect(set.applied).toEqual([]);
    timers.fire(); await settle();
    expect(attempts).toEqual([1, 2, 3]);
    expect(set.applied).toEqual([set.loaded]);
    expect(timers.pending.size).toBe(0);
  });

  it('loads on the first probe without constructing a replacement or scheduling retries', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet({ initial: 'success' });
    let replacements = 0;
    startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace() {
      replacements++;
      return { load: async () => set.loaded };
    } });
    await settle();
    expect(set.requests).toHaveLength(1);
    expect(timers.delays).toEqual([]);
    expect(replacements).toBe(0);
    expect(set.applied).toEqual([]);
  });

  it.each(['unchecked', 'missing'] as const)('retries a resolved probe that is %s', async (initial) => {
    const timers = new FakeTimers();
    const set = fakeFontSet({ initial });
    startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({ load: async () => set.loaded }) });
    await settle();
    expect(timers.delays).toEqual([1000]);
    timers.fire(); await settle();
    expect(set.applied).toEqual([set.loaded]);
  });

  it('stops after three unsuccessful retries without applying a failed face', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({
      load: async () => { throw new Error('offline'); },
    }) });
    await settle();
    for (let attempt = 0; attempt < 3; attempt++) { timers.fire(); await settle(); }
    expect(timers.delays).toEqual([1000, 3000, 10000]);
    expect(timers.pending.size).toBe(0);
    expect(set.applied).toEqual([]);
  });

  it('disposal cancels a scheduled retry', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    const dispose = startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({ load: async () => set.loaded }) });
    await settle();
    expect(timers.pending.size).toBe(1);
    dispose();
    expect(timers.pending.size).toBe(0);
    expect(set.applied).toEqual([]);
  });

  it('disposal during a retry prevents a late success from changing the font set', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    let finish!: (face: FontFace) => void;
    const dispose = startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({
      load: () => new Promise<FontFace>((resolve) => { finish = resolve; }),
    }) });
    await settle();
    timers.fire();
    dispose();
    finish(set.loaded); await settle();
    expect(set.applied).toEqual([]);
    expect(timers.pending.size).toBe(0);
  });

  it('a probe that settles after disposal schedules nothing', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet({ initial: 'unchecked' });
    const dispose = startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({ load: async () => set.loaded }) });
    dispose();
    await settle();
    expect(timers.delays).toEqual([]);
    expect(set.applied).toEqual([]);
  });

  it('a probe that fails after disposal schedules nothing', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    const dispose = startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({ load: async () => set.loaded }) });
    dispose();
    await settle();
    expect(timers.delays).toEqual([]);
  });

  it('a retry that fails after disposal schedules no further retry', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    let fail!: (error: Error) => void;
    const dispose = startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({
      load: () => new Promise<FontFace>((_resolve, reject) => { fail = reject; }),
    }) });
    await settle();
    timers.fire();
    dispose();
    fail(new Error('offline')); await settle();
    expect(timers.delays).toEqual([1000]);
    expect(timers.pending.size).toBe(0);
  });

  it('a retry whose timer port could not cancel it does nothing once disposed', async () => {
    const timers = new FakeTimers();
    let scheduled!: () => void;
    const uncancellable: FontRetryTimers = { setTimeout(run) { scheduled = run; return 1; }, clearTimeout() {} };
    const set = fakeFontSet();
    let faces = 0;
    const dispose = startRemixIconFontRecovery({ fonts: set.fonts, timers: uncancellable, createFace: () => { faces++; return { load: async () => set.loaded }; } });
    await settle();
    dispose();
    scheduled(); await settle();
    expect(faces).toBe(0);
    expect(set.applied).toEqual([]);
    expect(timers.delays).toEqual([]);
  });

  it('honours custom retry delays', async () => {
    const timers = new FakeTimers();
    const set = fakeFontSet();
    startRemixIconFontRecovery({ fonts: set.fonts, timers, createFace: () => ({ load: async () => { throw new Error('offline'); } }) }, { retryDelays: [5] });
    await settle();
    timers.fire(); await settle();
    expect(timers.delays).toEqual([5]);
    expect(timers.pending.size).toBe(0);
  });
});


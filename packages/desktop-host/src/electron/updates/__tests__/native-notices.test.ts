/**
 * Native boxes through fake `dialog`/`BrowserWindow` ports: which window parents a box, what the
 * "Update ready" prompt answers, and that the OFF preference suppresses a queued prompt. The copy
 * here is neutral and echoes its inputs; the host tests its own wording.
 */
import { describe, expect, it } from 'vitest';
import {
  explainOthersOpen, othersOpenOptions, promptUpdateReady, showNativeNotice, showOnFocusedWindow, updateReadyPromptOptions,
} from '../native-notices.js';
import type { NativeMessageBoxOptions, OthersOpenCopy, UpdateReadyPromptCopy } from '../native-notices.js';

interface FakeWindow { name: string }

/** Records every box: `parent` is the window it was parented to, or null when app-modal. */
function fakeDialog({ response = 0 }: { response?: number } = {}) {
  const shown: { parent: FakeWindow | null; options: NativeMessageBoxOptions }[] = [];
  const dialog = {
    showMessageBox(first: FakeWindow | NativeMessageBoxOptions, second?: NativeMessageBoxOptions) {
      if (second) shown.push({ parent: first as FakeWindow, options: second });
      else shown.push({ parent: null, options: first as NativeMessageBoxOptions });
      return Promise.resolve({ response });
    },
  };
  return { dialog, shown };
}

function windowsOf({ focused, all }: { focused: FakeWindow | null; all: FakeWindow[] }) {
  return { getFocusedWindow: () => focused, getAllWindows: () => all };
}

const A = { name: 'a' };
const B = { name: 'b' };
const readyCopy: UpdateReadyPromptCopy = {
  message: 'ready', detail: ({ version }) => `v=${version}`, restartLabel: 'restart', laterLabel: 'later',
};
const othersCopy: OthersOpenCopy = { message: 'others', detail: ({ count }) => `n=${count}` };

describe('parenting', () => {
  it('a box parents to the focused window, else the first open window, else none', async () => {
    const cases: [FakeWindow | null, FakeWindow[], FakeWindow | null][] = [
      [B, [A, B], B],
      [null, [A, B], A],
      [null, [], null],
    ];
    for (const [focused, all, expected] of cases) {
      const { dialog, shown } = fakeDialog();
      await showOnFocusedWindow({ dialog, windows: windowsOf({ focused, all }), options: { message: 'm' } });
      expect(shown).toEqual([{ parent: expected, options: { message: 'm' } }]);
    }
  });

  it("a notice is one box with the host's acknowledge label, carrying the notice's type, message and detail", () => {
    const { dialog, shown } = fakeDialog();
    showNativeNotice({ dialog, windows: windowsOf({ focused: A, all: [A] }), okLabel: 'ack',
      notice: { type: 'error', message: 'failed', detail: 'again' } });
    expect(shown).toEqual([{ parent: A, options: { type: 'error', message: 'failed', detail: 'again', buttons: ['ack'] } }]);
  });

  it('a notice with no open window is app-modal rather than lost', () => {
    const { dialog, shown } = fakeDialog();
    showNativeNotice({ dialog, windows: windowsOf({ focused: null, all: [] }), okLabel: 'ack',
      notice: { type: 'info', message: 'm', detail: 'd' } });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.parent).toBeNull();
  });
});

describe('the Update ready prompt', () => {
  it("puts the host's Restart first as the default and cancels to Later", () => {
    expect(updateReadyPromptOptions({ copy: readyCopy, version: '1.4.0' })).toEqual({
      type: 'info', buttons: ['restart', 'later'], defaultId: 0, cancelId: 1, message: 'ready', detail: 'v=1.4.0',
    });
  });

  it('resolves true only for Restart (button 0)', async () => {
    for (const [response, expected] of [[0, true], [1, false], [-1, false]] as const) {
      const { dialog, shown } = fakeDialog({ response });
      const restart = await promptUpdateReady({ dialog, windows: windowsOf({ focused: A, all: [A] }),
        automaticUpdates: () => true, version: '2.0.0', copy: readyCopy });
      expect(restart).toBe(expected);
      expect(shown[0]!.parent).toBe(A);
      expect(shown[0]!.options).toEqual(updateReadyPromptOptions({ copy: readyCopy, version: '2.0.0' }));
    }
  });

  it('a prompt queued before the preference turned OFF shows nothing and declines the restart', async () => {
    const { dialog, shown } = fakeDialog({ response: 0 });
    const restart = await promptUpdateReady({ dialog, windows: windowsOf({ focused: A, all: [A] }),
      automaticUpdates: () => false, version: '2.0.0', copy: readyCopy });
    expect(restart).toBe(false);
    expect(shown).toEqual([]);
  });
});

describe('the others-open explanation', () => {
  it("is app-modal and passes the count to the host's wording", () => {
    const { dialog, shown } = fakeDialog();
    explainOthersOpen({ dialog, count: 1, copy: othersCopy });
    explainOthersOpen({ dialog, count: 3, copy: othersCopy });
    expect(shown.map(box => [box.parent, box.options.detail])).toEqual([[null, 'n=1'], [null, 'n=3']]);
    expect(othersOpenOptions({ copy: othersCopy, count: 2 })).toEqual({ type: 'info', message: 'others', detail: 'n=2' });
  });
});

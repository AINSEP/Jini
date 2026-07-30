/**
 * Test helper: parses a generated surface document and executes its OWN script (not the bridge —
 * `bridge.test.ts` covers that separately) against a stub `window.jiniMcpUi`.
 *
 * Running the real emitted source is the point. A surface builder's output is a string, so asserting
 * on its text proves only that it was spelled a particular way; asserting that clicking the rendered
 * confirm button produces a `tools/call` with the right params proves the dialog works.
 */
import { expect, vi } from 'vitest';

export interface PendingSurfaceCall {
  readonly tool: string;
  readonly params: Record<string, unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export function mountSurface(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const calls: PendingSurfaceCall[] = [];
  const api = {
    callTool: vi.fn(
      (tool: string, params: Record<string, unknown>) =>
        new Promise<unknown>((resolve, reject) => {
          calls.push({ tool, params, resolve, reject });
        }),
    ),
    notify: vi.fn(),
    openLink: vi.fn(),
    requestTeardown: vi.fn(),
    whenReady: vi.fn((fn: () => void) => fn()),
    hostContext: () => null,
    isReady: () => true,
  };

  const scripts = [...doc.querySelectorAll('script')];
  const surfaceScript = scripts[1]?.textContent ?? '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', 'document', surfaceScript)({ jiniMcpUi: api }, doc);

  function button(action: string): HTMLButtonElement {
    const node = doc.querySelector<HTMLButtonElement>(`button[data-mcpui-action="${action}"]`);
    expect(node, `no button for action "${action}"`).not.toBeNull();
    return node!;
  }

  return {
    doc,
    api,
    calls,
    button,
    click(action: string) {
      button(action).dispatchEvent(new Event('click', { bubbles: true }));
    },
    submit() {
      doc.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    },
    status(): string {
      return doc.getElementById('mcpui-status')?.textContent ?? '';
    },
    statusState(): string | null {
      return doc.getElementById('mcpui-status')?.getAttribute('data-state') ?? null;
    },
    disabledActions(): boolean[] {
      return [...doc.querySelectorAll('button[data-mcpui-action]')].map((node) => (node as HTMLButtonElement).disabled);
    },
    /** Settles the newest pending call and lets its `.then` run. */
    async settle(outcome: 'resolve' | 'reject', value: unknown) {
      const call = calls.at(-1);
      expect(call, 'no tool call is pending').not.toBeUndefined();
      if (outcome === 'resolve') call!.resolve(value);
      else call!.reject(value);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

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

/**
 * @param beforeScript - Runs against the parsed document before the surface script does, for state
 *   the script reads at load (e.g. `visibilityState`).
 */
export function mountSurface(html: string, beforeScript?: (doc: Document) => void) {
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

  // `isTrusted` is an unforgeable own property in jsdom, so no test can dispatch a trusted event.
  // Instead, every listener the surface script adds to a button or a form is wrapped: while `trustNext` is set,
  // the listener receives the REAL dispatched event seen through a view whose `isTrusted` reads true.
  // The product script is unchanged; only what this harness hands it differs.
  let trustNext = false;
  for (const node of doc.querySelectorAll<HTMLElement>('[data-mcpui-action], form')) {
    const add = node.addEventListener.bind(node);
    node.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) =>
      add(type, (event: Event) => listener(trustNext ? asTrusted(event) : event), options)) as typeof node.addEventListener;
  }

  beforeScript?.(doc);
  const scripts = [...doc.querySelectorAll('script')];
  const surfaceScript = scripts[1]?.textContent ?? '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', 'document', surfaceScript)({ jiniMcpUi: api }, doc);

  /** Runs `dispatch` so every event it fires at a button or form reads `isTrusted: true`. */
  function asUser(dispatch: () => void): void {
    trustNext = true;
    try {
      dispatch();
    } finally {
      trustNext = false;
    }
  }

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
    /** An untrusted click — what `element.click()` or `dispatchEvent` from any script produces. */
    click(action: string) {
      button(action).dispatchEvent(new Event('click', { bubbles: true }));
    },
    /** A click the surface script sees as `isTrusted: true`, i.e. one the browser says a user made. */
    trustedClick(action: string) {
      asUser(() => button(action).dispatchEvent(new Event('click', { bubbles: true })));
    },
    asUser,
    /** A trusted Enter keydown in `target`, the way a person presses it. */
    pressEnter(target: Element) {
      asUser(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    },
    /**
     * A person clicking the submit button (a trusted click) — deliberately NOT a synthetic "submit" `Event` on the form. The
     * sandbox these documents actually render in (`allow-scripts`, no `allow-forms`) blocks native
     * form submission before the "submit" event is ever dispatched, so a helper that fired that
     * event directly could report every one of these specs green while the real click path stayed
     * broken in production — which is exactly what happened before `form.ts`'s `runSubmit` moved off
     * the "submit" event onto the button's "click". See `form.test.ts`'s "does not depend on the
     * form's submit event" for the regression test this rewrite exists to make possible.
     */
    submit() {
      asUser(() => button('submit').dispatchEvent(new Event('click', { bubbles: true })));
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

/** The dispatched event, except `isTrusted` reads true. Reads go to the real event so jsdom's brand checks pass. */
function asTrusted(event: Event): Event {
  return new Proxy(event, {
    get(target, prop) {
      if (prop === 'isTrusted') return true;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

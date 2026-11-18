/** TEST-ONLY: a handle driver over core's own handle resolution, so a test can drive chat's published
 * handles without the real DOM page driver (which is agentic's, and proved there and in integration). */
import { fireEvent } from '@testing-library/react';
import { resolveHandleSelector } from '@jini-ai/core/agent-handles';

export interface FakeHandleDriver {
  click(required: { handle: string }, optional?: Record<string, never>): Promise<void>;
  fill(required: { handle: string; text: string }, optional?: Record<string, never>): Promise<void>;
}

/** Finds `handle` under `root` the way the real driver does (a handle is never a CSS selector) and acts on it with DOM events. */
export function fakeHandleDriver(required: { root: Element }, _optional: Record<string, never> = {}): FakeHandleDriver {
  const find = (handle: string): Element => {
    const element = required.root.querySelector(resolveHandleSelector({ handle }));
    if (!element) throw new Error(`no element published as "${handle}" on this page`);
    return element;
  };
  return {
    click: async ({ handle }) => { fireEvent.click(find(handle)); },
    fill: async ({ handle, text }) => { fireEvent.change(find(handle), { target: { value: text } }); },
  };
}

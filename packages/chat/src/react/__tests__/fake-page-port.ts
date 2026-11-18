/** TEST-ONLY: a handle driver over core's own handle resolution, so a test can drive chat's published
 * handles without the real DOM page driver (which is agentic's, and proved there and in integration). */
import { fireEvent } from '@testing-library/react';
import { resolveHandleSelector } from '@jini-ai/core/agent-handles';
import type { ChatPagePort } from '../../core/page-port.js';

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

/** One `execute` call a fake port saw. */
export interface FakePageCall {
  readonly capabilityId: string;
  readonly input: Record<string, unknown>;
  readonly signal?: AbortSignal | undefined;
}

export interface FakeChatPagePort extends ChatPagePort {
  /** Every `execute` call, in order, kept as data. */
  readonly calls: FakePageCall[];
}

/** The page capability ids a host with a DOM driver serves, as a literal list so a rename in agentic shows up in its own twin test, not here. */
export const FAKE_PAGE_CAPABILITY_IDS = [
  'page.find_elements', 'page.highlight', 'page.scroll_to', 'page.click', 'page.fill', 'page.select_option', 'page.navigate',
] as const;

/**
 * TEST-ONLY: a `ChatPagePort` that records what chat forwards and answers from data. `results` maps a
 * capability id to its answer; `run` replaces that for a test that needs an effect, a wait or a throw.
 * That the REAL port reaches the real driver method is proved in agentic's `page-port.test.ts`.
 */
export function fakeChatPagePort(
  _required = {},
  optional: {
    capabilityIds?: readonly string[];
    results?: Readonly<Record<string, unknown>>;
    run?: (call: FakePageCall) => unknown;
  } = {},
): FakeChatPagePort {
  const calls: FakePageCall[] = [];
  return {
    capabilityIds: optional.capabilityIds ?? FAKE_PAGE_CAPABILITY_IDS,
    calls,
    execute: async ({ capabilityId, input }, { signal } = {}) => {
      const call: FakePageCall = { capabilityId, input, signal };
      calls.push(call);
      return optional.run ? await optional.run(call) : optional.results?.[capabilityId];
    },
  };
}

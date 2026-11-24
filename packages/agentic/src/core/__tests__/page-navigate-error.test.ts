import { describe, expect, it } from 'vitest';

import { executePageCapability } from '../page-executor.js';
import type { PageDriver } from '../page-driver.js';
import {
  PAGE_NAVIGATE_TOOL_ID,
  rewrapPageNavigateError,
  withPageNavigateErrorRewrap,
  type DescribePageNavigateRefusal,
  type PageNavigateRegistration,
} from '../page-navigate-error.js';

/**
 * @file Certifies the `page.navigate` refusal rewrap. Asserted against the EXACT executor wording
 * (`` `"${safePage}" is not a published page. Available: ${...}` ``), not a paraphrase, so a future
 * change to that message's shape is caught here rather than silently failing to match.
 */

const describeRefusal: DescribePageNavigateRefusal = ({ page, availableScreens }) =>
  `"${page}" is not a registered screen id. Available screens: ${availableScreens}.`;

function fakeRegistration(id: string, handler: () => Promise<unknown>): PageNavigateRegistration & { handler: () => Promise<unknown> } {
  return { descriptor: { id }, handler };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a rejection'); }, (err: unknown) => err);
}

describe('rewrapPageNavigateError', () => {
  it("hands the exact 'not a published page' refusal's page and screen list to the host's describeRefusal", () => {
    const upstream = new Error('"pricing" is not a published page. Available: posts, pages, settings');
    const rewrapped = rewrapPageNavigateError({ err: upstream, describeRefusal });
    expect(rewrapped).toBeInstanceOf(Error);
    expect((rewrapped as Error).message).toBe('"pricing" is not a registered screen id. Available screens: posts, pages, settings.');
  });

  it('passes an error with unrelated text through as the SAME object', () => {
    const other = new Error('some other failure entirely');
    expect(rewrapPageNavigateError({ err: other, describeRefusal })).toBe(other);
  });

  it('passes a non-Error rejection value through unchanged', () => {
    const notAnError = { weird: 'rejection shape' };
    expect(rewrapPageNavigateError({ err: notAnError, describeRefusal })).toBe(notAnError);
  });

  it("handles an empty 'Available:' list ('(none)')", () => {
    const rewrapped = rewrapPageNavigateError({ err: new Error('"anything" is not a published page. Available: (none)'), describeRefusal }) as Error;
    expect(rewrapped.message).toContain('Available screens: (none).');
  });

  it("rewraps the real executor's refusal without navigating", async () => {
    let navigations = 0;
    const driver = {
      listPages: async () => [{ id: 'posts', label: 'Posts' }, { id: 'settings', label: 'Settings' }],
      navigate: async () => { navigations++; },
    } as unknown as PageDriver;
    const error = await rejection(executePageCapability({ driver, capabilityId: 'page.navigate', input: { page: 'missing-page' } }));
    const rewrapped = rewrapPageNavigateError({ err: error, describeRefusal }) as Error;
    expect(rewrapped).not.toBe(error);
    expect(rewrapped.message).toBe('"missing-page" is not a registered screen id. Available screens: posts (Posts), settings (Settings).');
    expect(navigations).toBe(0);
  });
});

describe('withPageNavigateErrorRewrap', () => {
  it("rewraps a rejecting page.navigate registration's handler and keeps the list length", async () => {
    const upstream = new Error('"pricing" is not a published page. Available: posts, pages');
    const wrapped = withPageNavigateErrorRewrap({ registrations: [fakeRegistration(PAGE_NAVIGATE_TOOL_ID, async () => { throw upstream; })], describeRefusal });
    expect(wrapped).toHaveLength(1);
    expect(((await rejection(wrapped[0]!.handler())) as Error).message).toBe('"pricing" is not a registered screen id. Available screens: posts, pages.');
  });

  it('leaves a SUCCESSFUL page.navigate call untouched', async () => {
    const wrapped = withPageNavigateErrorRewrap({ registrations: [fakeRegistration(PAGE_NAVIGATE_TOOL_ID, async () => ({ navigatedTo: 'posts' }))], describeRefusal });
    expect(await wrapped[0]!.handler()).toEqual({ navigatedTo: 'posts' });
  });

  it("returns every OTHER tool's registration as the SAME object", () => {
    const original = fakeRegistration('chat.send_message', async () => ({ sent: true }));
    expect(withPageNavigateErrorRewrap({ registrations: [original], describeRefusal })[0]).toBe(original);
  });

  it('rethrows an unrelated page.navigate failure unchanged', async () => {
    const other = new Error('some unrelated internal failure');
    const wrapped = withPageNavigateErrorRewrap({ registrations: [fakeRegistration(PAGE_NAVIGATE_TOOL_ID, async () => { throw other; })], describeRefusal });
    expect(await rejection(wrapped[0]!.handler())).toBe(other);
  });
});

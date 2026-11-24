import { describe, expect, test } from 'vitest';

import { PAGE_CAPABILITIES } from '../page-capabilities.js';
import { pageActionPublishedForTarget, publishedPageActionNeedsConfirmation, type PagePublication } from '../page-publication.js';
import { acceptsPublishedPageInput, summarizePageTargets } from '../published-page-input.js';

/** @file Pure manifest gates an untrusted-caller page executor applies before anything runs:
 * action-class eligibility, forced confirmation, input acceptance and bounded target summaries. */

const publication: PagePublication = { revision: 'rev', elements: [
  { handle: 'send', action: 'submit' }, { handle: 'menu', action: 'menu' }, { handle: 'field', action: 'fill' }, { handle: 'link', action: 'navigate' },
] };
const capability = (id: string) => PAGE_CAPABILITIES.find(entry => entry.id === id)!;

describe('publishedPageActionNeedsConfirmation', () => {
  // Moved from the host's visitor-page-confirmation unit test with the function it covered.
  test('fill/select and a published submitter always require confirmation, menu clicks do not', () => {
    for (const capabilityId of ['page.fill', 'page.select_option']) expect(publishedPageActionNeedsConfirmation({ capabilityId, input: { handle: 'field' }, publication })).toBe(true);
    expect(publishedPageActionNeedsConfirmation({ capabilityId: 'page.click', input: { handle: 'send' }, publication })).toBe(true);
    expect(publishedPageActionNeedsConfirmation({ capabilityId: 'page.click', input: { handle: 'menu' }, publication })).toBe(false);
    expect(publishedPageActionNeedsConfirmation({ capabilityId: 'page.click', input: null, publication })).toBe(false);
  });
});

describe('pageActionPublishedForTarget', () => {
  test('navigation and discovery need no element; gated tools need a reviewed class', () => {
    expect(pageActionPublishedForTarget({ capabilityId: 'page.navigate' })).toBe(true);
    expect(pageActionPublishedForTarget({ capabilityId: 'page.find_elements' })).toBe(true);
    expect(pageActionPublishedForTarget({ capabilityId: 'page.click' })).toBe(false);
    expect(pageActionPublishedForTarget({ capabilityId: 'page.click', element: { handle: 'menu', action: 'menu' } })).toBe(true);
    // An anchor must use validated navigation, never an automatic click.
    expect(pageActionPublishedForTarget({ capabilityId: 'page.click', element: { handle: 'link', action: 'navigate' } })).toBe(false);
    expect(pageActionPublishedForTarget({ capabilityId: 'page.fill', element: { handle: 'menu', action: 'menu' } })).toBe(false);
    expect(pageActionPublishedForTarget({ capabilityId: 'page.select_option', element: { handle: 's', action: 'select' } })).toBe(true);
  });
});

describe('acceptsPublishedPageInput', () => {
  test('rejects non-objects, schema failures and unpublished handles', () => {
    const click = capability('page.click');
    expect(acceptsPublishedPageInput({ capability: click, input: null, publication })).toBe(false);
    expect(acceptsPublishedPageInput({ capability: click, input: [{ handle: 'menu' }], publication })).toBe(false);
    expect(acceptsPublishedPageInput({ capability: click, input: {}, publication })).toBe(false);
    expect(acceptsPublishedPageInput({ capability: click, input: { handle: 'ghost' }, publication })).toBe(false);
    expect(acceptsPublishedPageInput({ capability: click, input: { handle: 'link' }, publication })).toBe(false);
    expect(acceptsPublishedPageInput({ capability: click, input: { handle: 'menu' }, publication })).toBe(true);
  });
});

describe('summarizePageTargets', () => {
  const pages = Array.from({ length: 130 }, (_, index) => ({ id: `p${index}`, label: `Page ${index}` }));
  test('leads with the navigation target, de-duplicates it and caps the list', () => {
    const summary = summarizePageTargets({ pages }, { navigation: pages[129] });
    expect(summary).toHaveLength(128);
    expect(summary[0]).toEqual({ id: 'p129', label: 'Page 129' });
    expect(summary.filter(page => page.id === 'p129')).toHaveLength(1);
    expect(summarizePageTargets({ pages }, { limit: 2 }).map(page => page.id)).toEqual(['p0', 'p1']);
  });
  test('normalizes labels before they can reach a model', () => {
    expect(summarizePageTargets({ pages: [{ id: 'x', label: '  Hello\u0000  world  ' }] })[0]!.label).not.toContain('\u0000');
  });
});

import { describe, expect, it } from 'vitest';
import { createFrontendNavigationGuard } from '../frontend-session-bridge.js';

const action = (capabilityId: string, input: Record<string, unknown> = {}) => ({ invocationId: 'invocation', capabilityId, input });

describe('frontend navigation guard', () => {
  it('adds an initial revision only to discovery object responses without changing them', () => {
    const guard = createFrontendNavigationGuard({});
    const output = { elements: [] };
    expect(guard.onBeforeResponse({ action: action('page.find_elements'), output })).toEqual({ elements: [], navigationRevision: 0 });
    expect(output).toEqual({ elements: [] });
    expect(guard.onBeforeResponse({ action: action('page.click'), output })).toBe(output);
    for (const other of [null, undefined, [], 1]) expect(guard.onBeforeResponse({ action: action('page.find_elements'), output: other })).toBe(other);
  });
  it('refuses a previously approved revision after navigating away and back', () => {
    const guard = createFrontendNavigationGuard({});
    const prior = guard.onBeforeResponse({ action: action('page.find_elements'), output: {} }) as { navigationRevision: number };
    guard.noteNavigation(); guard.noteNavigation();
    expect(() => guard.preparePageInput({ action: action('page.click', { handle: 'delete', __frontendNavigationRevision: prior.navigationRevision }) }))
      .toThrow('page changed while confirmation was pending');
    expect(guard.onBeforeResponse({ action: action('page.find_elements'), output: {} })).toEqual({ navigationRevision: 2 });
  });
  it('accepts the current revision, strips internal metadata and never mutates caller input', () => {
    const guard = createFrontendNavigationGuard({}); guard.noteNavigation();
    const input = { handle: 'delete', __frontendNavigationRevision: 1 };
    expect(guard.preparePageInput({ action: action('page.click', input) })).toEqual({ handle: 'delete' });
    expect(input).toEqual({ handle: 'delete', __frontendNavigationRevision: 1 });
  });
  it('leaves direct calls without metadata unchanged and strips current metadata for every page verb', () => {
    const guard = createFrontendNavigationGuard({}); guard.noteNavigation();
    const input = { handle: 'reviewed-direct-control' };
    expect(guard.preparePageInput({ action: action('page.click', input) })).toEqual(input);
    expect(guard.preparePageInput({ action: action('page.find_elements', { query: '', __frontendNavigationRevision: 1 }) })).toEqual({ query: '' });
  });
  it.each(['0', undefined, null, {}, 'future', -1, 0.5, Number.NaN, Infinity])('rejects a supplied invalid revision %j', revision => {
    const guard = createFrontendNavigationGuard({});
    expect(() => guard.preparePageInput({ action: action('page.click', { __frontendNavigationRevision: revision }) })).toThrow('propose');
  });
});

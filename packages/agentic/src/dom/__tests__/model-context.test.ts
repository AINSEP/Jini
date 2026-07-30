import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentModelContext, type AgentModelContextLike } from '../model-context.js';

/**
 * Feature detection for the draft WebMCP surface. The contract this file pins down is deliberately
 * narrow and entirely about *absence*: this module never installs a polyfill, so every path other
 * than "a valid surface is already there" must return `undefined` rather than throw — a page
 * without WebMCP is the common case, not an error.
 *
 * The document-then-navigator order matters and is not arbitrary: the spec moved the getter from
 * Navigator to Document in 2026, so a page can legitimately carry both (a modern polyfill
 * installing on `document` while an older one, or the same polyfill's back-compat alias, still sits
 * on `navigator`). Native/modern wins.
 *
 * Everything here stubs the globals with `vi.stubGlobal` in a single file rather than splitting the
 * "no document at all" case into a separate `node`-environment test file — the environment-split
 * approach makes v8 coverage report the SSR guards as uncovered even though both sides run.
 */

function fakeSurface(tag: string): AgentModelContextLike & { tag: string } {
  return { tag, registerTool: async () => undefined };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAgentModelContext', () => {
  it('returns document.modelContext when the page carries a valid surface there', () => {
    const surface = fakeSurface('document');
    vi.stubGlobal('document', { modelContext: surface });
    expect(getAgentModelContext()).toBe(surface);
  });

  it('prefers document.modelContext over the deprecated navigator alias when both are installed', () => {
    // A page can genuinely have both — the spec moved the getter to Document, and polyfills keep
    // the Navigator spelling working. The newer location must win, or a page that upgraded its
    // polyfill would keep talking to the stale surface.
    const onDocument = fakeSurface('document');
    const onNavigator = fakeSurface('navigator');
    vi.stubGlobal('document', { modelContext: onDocument });
    vi.stubGlobal('navigator', { modelContext: onNavigator });
    expect(getAgentModelContext()).toBe(onDocument);
  });

  it('falls back to navigator.modelContext when document carries no surface', () => {
    const surface = fakeSurface('navigator');
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { modelContext: surface });
    expect(getAgentModelContext()).toBe(surface);
  });

  it('rejects a document.modelContext that is not a WebMCP surface and falls through to navigator', () => {
    // A half-installed or unrelated global squatting on the property name is not a surface. Handing
    // it back would make the very first `registerTool` call a TypeError at the call site, far away
    // from the bad global — so the shape check has to happen here.
    const surface = fakeSurface('navigator');
    vi.stubGlobal('document', { modelContext: { registerTool: 'not a function' } });
    vi.stubGlobal('navigator', { modelContext: surface });
    expect(getAgentModelContext()).toBe(surface);
  });

  it('returns undefined when navigator.modelContext is also the wrong shape', () => {
    vi.stubGlobal('document', { modelContext: {} });
    vi.stubGlobal('navigator', { modelContext: 42 });
    expect(getAgentModelContext()).toBeUndefined();
  });

  it('returns undefined for a null modelContext, which is an object but not a surface', () => {
    vi.stubGlobal('document', { modelContext: null });
    vi.stubGlobal('navigator', { modelContext: null });
    expect(getAgentModelContext()).toBeUndefined();
  });

  it('returns undefined on a page with neither property installed', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {});
    expect(getAgentModelContext()).toBeUndefined();
  });

  it('returns undefined with no document or navigator global at all, rather than throwing', () => {
    // The DOM-free path: this module is reachable from code that also runs server-side, so a
    // missing global must be an "unavailable" answer, not a crash.
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(getAgentModelContext()).toBeUndefined();
  });

  it('accepts a surface that also exposes the non-spec unregisterTool escape hatch', () => {
    // `unregisterTool` is not in the draft (aborting `registerTool`'s signal is the real cleanup
    // path); it is tolerated so a polyfill that happens to ship one is still usable.
    const surface: AgentModelContextLike = { registerTool: async () => undefined, unregisterTool: () => undefined };
    vi.stubGlobal('document', { modelContext: surface });
    expect(getAgentModelContext()).toBe(surface);
  });
});

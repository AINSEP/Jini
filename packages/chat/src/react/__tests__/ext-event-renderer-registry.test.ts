import { describe, expect, it } from 'vitest';
import { clearExtEventRenderers, getExtEventRenderer, registerExtEventRenderer } from '../ext-event-renderer-registry.js';

describe('ext-event-renderer-registry', () => {
  it('registers a renderer and resolves it by name', () => {
    clearExtEventRenderers();
    const renderer = () => 'rendered';
    registerExtEventRenderer({ name: 'a2ui', renderer });
    expect(getExtEventRenderer({ name: 'a2ui' })).toBe(renderer);
  });

  it('returns undefined for a name with no registered renderer', () => {
    clearExtEventRenderers();
    expect(getExtEventRenderer({ name: 'nope' })).toBeUndefined();
  });

  it('re-registering the same name overwrites — last writer wins', () => {
    clearExtEventRenderers();
    const first = () => 'first';
    const second = () => 'second';
    registerExtEventRenderer({ name: 'live_artifact', renderer: first });
    registerExtEventRenderer({ name: 'live_artifact', renderer: second });
    expect(getExtEventRenderer({ name: 'live_artifact' })).toBe(second);
  });

  it('the returned unregister handle removes the renderer it was created for', () => {
    clearExtEventRenderers();
    const renderer = () => 'x';
    const unregister = registerExtEventRenderer({ name: 'plugin_candidate', renderer });
    expect(getExtEventRenderer({ name: 'plugin_candidate' })).toBe(renderer);
    unregister();
    expect(getExtEventRenderer({ name: 'plugin_candidate' })).toBeUndefined();
  });

  it('a stale unregister handle is a no-op once a newer registration has replaced it', () => {
    clearExtEventRenderers();
    const first = () => 'first';
    const second = () => 'second';
    const unregisterFirst = registerExtEventRenderer({ name: 'a2ui', renderer: first });
    registerExtEventRenderer({ name: 'a2ui', renderer: second });
    unregisterFirst();
    expect(getExtEventRenderer({ name: 'a2ui' })).toBe(second);
  });

  it('clearExtEventRenderers() removes every registration', () => {
    clearExtEventRenderers();
    registerExtEventRenderer({ name: 'a', renderer: () => 'a' });
    registerExtEventRenderer({ name: 'b', renderer: () => 'b' });
    clearExtEventRenderers();
    expect(getExtEventRenderer({ name: 'a' })).toBeUndefined();
    expect(getExtEventRenderer({ name: 'b' })).toBeUndefined();
  });
});

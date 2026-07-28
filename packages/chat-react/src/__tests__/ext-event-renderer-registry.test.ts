import { describe, expect, it } from 'vitest';
import { clearExtEventRenderers, getExtEventRenderer, registerExtEventRenderer } from '../ext-event-renderer-registry.js';

describe('ext-event-renderer-registry', () => {
  it('registers a renderer and resolves it by name', () => {
    clearExtEventRenderers();
    const renderer = () => 'rendered';
    registerExtEventRenderer('a2ui', renderer);
    expect(getExtEventRenderer('a2ui')).toBe(renderer);
  });

  it('returns undefined for a name with no registered renderer', () => {
    clearExtEventRenderers();
    expect(getExtEventRenderer('nope')).toBeUndefined();
  });

  it('re-registering the same name overwrites — last writer wins', () => {
    clearExtEventRenderers();
    const first = () => 'first';
    const second = () => 'second';
    registerExtEventRenderer('live_artifact', first);
    registerExtEventRenderer('live_artifact', second);
    expect(getExtEventRenderer('live_artifact')).toBe(second);
  });

  it('the returned unregister handle removes the renderer it was created for', () => {
    clearExtEventRenderers();
    const renderer = () => 'x';
    const unregister = registerExtEventRenderer('plugin_candidate', renderer);
    expect(getExtEventRenderer('plugin_candidate')).toBe(renderer);
    unregister();
    expect(getExtEventRenderer('plugin_candidate')).toBeUndefined();
  });

  it('a stale unregister handle is a no-op once a newer registration has replaced it', () => {
    clearExtEventRenderers();
    const first = () => 'first';
    const second = () => 'second';
    const unregisterFirst = registerExtEventRenderer('a2ui', first);
    registerExtEventRenderer('a2ui', second);
    unregisterFirst();
    expect(getExtEventRenderer('a2ui')).toBe(second);
  });

  it('clearExtEventRenderers() removes every registration', () => {
    clearExtEventRenderers();
    registerExtEventRenderer('a', () => 'a');
    registerExtEventRenderer('b', () => 'b');
    clearExtEventRenderers();
    expect(getExtEventRenderer('a')).toBeUndefined();
    expect(getExtEventRenderer('b')).toBeUndefined();
  });
});

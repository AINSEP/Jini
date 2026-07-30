import { describe, expect, it } from 'vitest';
import { clearToolRenderers, getToolRenderer, registerToolRenderer } from '../tool-renderer-registry.js';

describe('tool-renderer-registry', () => {
  it('registers a renderer and resolves it by name', () => {
    clearToolRenderers();
    const renderer = () => 'rendered';
    registerToolRenderer('Bash', renderer);
    expect(getToolRenderer('Bash')).toBe(renderer);
  });

  it('returns undefined for a name with no registered renderer', () => {
    clearToolRenderers();
    expect(getToolRenderer('Nope')).toBeUndefined();
  });

  it('re-registering the same name overwrites — last writer wins', () => {
    clearToolRenderers();
    const first = () => 'first';
    const second = () => 'second';
    registerToolRenderer('Read', first);
    registerToolRenderer('Read', second);
    expect(getToolRenderer('Read')).toBe(second);
  });

  it('the returned unregister handle removes the renderer it was created for', () => {
    clearToolRenderers();
    const renderer = () => 'x';
    const unregister = registerToolRenderer('Grep', renderer);
    expect(getToolRenderer('Grep')).toBe(renderer);
    unregister();
    expect(getToolRenderer('Grep')).toBeUndefined();
  });

  it('a stale unregister handle is a no-op once a newer registration has replaced it', () => {
    clearToolRenderers();
    const first = () => 'first';
    const second = () => 'second';
    const unregisterFirst = registerToolRenderer('Glob', first);
    registerToolRenderer('Glob', second);
    // The stale handle must not delete the newer registration it no longer owns.
    unregisterFirst();
    expect(getToolRenderer('Glob')).toBe(second);
  });

  it('clearToolRenderers() removes every registration', () => {
    clearToolRenderers();
    registerToolRenderer('A', () => 'a');
    registerToolRenderer('B', () => 'b');
    clearToolRenderers();
    expect(getToolRenderer('A')).toBeUndefined();
    expect(getToolRenderer('B')).toBeUndefined();
  });
});

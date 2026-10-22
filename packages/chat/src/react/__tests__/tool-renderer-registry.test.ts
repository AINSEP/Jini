import { describe, expect, it } from 'vitest';
import { clearToolRenderers, getToolRenderer, registerToolRenderer } from '../tool-renderer-registry.js';

describe('tool-renderer-registry', () => {
  it('registers a renderer and resolves it by name', () => {
    clearToolRenderers({});
    const renderer = () => 'rendered';
    registerToolRenderer({ name: 'Bash', renderer: renderer });
    expect(getToolRenderer({ name: 'Bash' })).toBe(renderer);
  });

  it('returns undefined for a name with no registered renderer', () => {
    clearToolRenderers({});
    expect(getToolRenderer({ name: 'Nope' })).toBeUndefined();
  });

  it('re-registering the same name overwrites — last writer wins', () => {
    clearToolRenderers({});
    const first = () => 'first';
    const second = () => 'second';
    registerToolRenderer({ name: 'Read', renderer: first });
    registerToolRenderer({ name: 'Read', renderer: second });
    expect(getToolRenderer({ name: 'Read' })).toBe(second);
  });

  it('the returned unregister handle removes the renderer it was created for', () => {
    clearToolRenderers({});
    const renderer = () => 'x';
    const unregister = registerToolRenderer({ name: 'Grep', renderer: renderer });
    expect(getToolRenderer({ name: 'Grep' })).toBe(renderer);
    unregister();
    expect(getToolRenderer({ name: 'Grep' })).toBeUndefined();
  });

  it('a stale unregister handle is a no-op once a newer registration has replaced it', () => {
    clearToolRenderers({});
    const first = () => 'first';
    const second = () => 'second';
    const unregisterFirst = registerToolRenderer({ name: 'Glob', renderer: first });
    registerToolRenderer({ name: 'Glob', renderer: second });
    // The stale handle must not delete the newer registration it no longer owns.
    unregisterFirst();
    expect(getToolRenderer({ name: 'Glob' })).toBe(second);
  });

  it('clearToolRenderers() removes every registration', () => {
    clearToolRenderers({});
    registerToolRenderer({ name: 'A', renderer: () => 'a' });
    registerToolRenderer({ name: 'B', renderer: () => 'b' });
    clearToolRenderers({});
    expect(getToolRenderer({ name: 'A' })).toBeUndefined();
    expect(getToolRenderer({ name: 'B' })).toBeUndefined();
  });
});

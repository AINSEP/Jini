import { describe, expect, it } from 'vitest';
import { createPostEditorRouteKeys } from '../post-editor-route-keys.js';

/** @file A save-driven slug rename keeps the editor's panel key; each store owns its own state. */
describe('createPostEditorRouteKeys', () => {
  it('is the segment itself until a rename is recorded', () => {
    expect(createPostEditorRouteKeys().keyFor({ segment: 'key-test-plain' })).toBe('key-test-plain');
  });

  it('maps a renamed slug back to the original key, through a chain of renames', () => {
    const keys = createPostEditorRouteKeys();
    keys.remember({ from: 'key-test-untitled-6', to: 'key-test-first' });
    keys.remember({ from: 'key-test-first', to: 'key-test-second' });
    expect(keys.keyFor({ segment: 'key-test-first' })).toBe('key-test-untitled-6');
    expect(keys.keyFor({ segment: 'key-test-second' })).toBe('key-test-untitled-6');
  });

  it('ignores a no-op rename', () => {
    const keys = createPostEditorRouteKeys();
    keys.remember({ from: 'key-test-same', to: 'key-test-same' });
    expect(keys.keyFor({ segment: 'key-test-same' })).toBe('key-test-same');
  });

  it('hands a new post its own draft key, then retires it on first save', () => {
    const keys = createPostEditorRouteKeys();
    const first = keys.keyFor({ segment: '' });
    keys.remember({ from: '', to: 'saved-a' });
    expect(keys.keyFor({ segment: 'saved-a' })).toBe(first);
    expect(keys.keyFor({ segment: '' })).not.toBe(first);
  });

  it('two instances never share renames or draft counters', () => {
    const a = createPostEditorRouteKeys();
    const b = createPostEditorRouteKeys();
    a.remember({ from: 'old-slug', to: 'new-slug' });
    a.remember({ from: '', to: 'draft-saved' });
    expect(b.keyFor({ segment: 'new-slug' })).toBe('new-slug');
    expect(b.keyFor({ segment: '' })).toBe('new-post-draft:1');
    expect(a.keyFor({ segment: '' })).toBe('new-post-draft:2');
  });
});

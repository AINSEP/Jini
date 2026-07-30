import { describe, expect, it } from 'vitest';

import { createExtractionLog, createNoteStore, createVerifyLog, enforceVerify, parseEntryFrontmatter, renderEntryFrontmatter } from '../index.js';

describe('@jini-ai/memory — barrel', () => {
  it('re-exports every module’s public surface', () => {
    expect(parseEntryFrontmatter).toBeTypeOf('function');
    expect(renderEntryFrontmatter).toBeTypeOf('function');
    expect(createNoteStore).toBeTypeOf('function');
    expect(createExtractionLog).toBeTypeOf('function');
    expect(createVerifyLog).toBeTypeOf('function');
    expect(enforceVerify).toBeTypeOf('function');

    const store = createNoteStore({ validTypes: ['user'], defaultType: 'user' });
    expect(store.dir('/tmp/x')).toContain('notes');
  });
});

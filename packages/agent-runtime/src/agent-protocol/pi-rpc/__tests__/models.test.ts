import { describe, expect, it } from 'vitest';
import { parsePiModels } from '../models.js';

describe('parsePiModels', () => {
  it('returns null for empty/whitespace-only stdout', () => {
    expect(parsePiModels({ stdout: '' })).toBeNull();
    expect(parsePiModels({ stdout: '   \n  ' })).toBeNull();
    expect(parsePiModels({ stdout: undefined })).toBeNull();
    expect(parsePiModels({ stdout: null })).toBeNull();
  });

  it('always includes the default sentinel first', () => {
    const result = parsePiModels({ stdout: 'PROVIDER MODEL\nopenai gpt-4' });
    expect(result?.[0]).toEqual({ id: 'default', label: 'Default (CLI config)' });
  });

  it('parses provider/model rows, skipping the header line', () => {
    const result = parsePiModels({ stdout: 'PROVIDER MODEL\nopenai gpt-4\nanthropic claude-3' });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-4', label: 'openai/gpt-4' },
      { id: 'anthropic/claude-3', label: 'anthropic/claude-3' },
    ]);
  });

  it('skips comment lines starting with #, so the header-skip lands on the first non-comment line', () => {
    // '# a comment' is filtered out before header-skipping, so 'PROVIDER
    // MODEL' becomes line[0] (the header, skipped) and 'openai gpt-4'
    // becomes the first data row.
    const result = parsePiModels({ stdout: '# a comment\nPROVIDER MODEL\nopenai gpt-4' });
    expect(result?.map((m) => m.id)).toEqual(['default', 'openai/gpt-4']);
  });

  it('skips rows with fewer than 2 whitespace-separated fields', () => {
    const result = parsePiModels({ stdout: 'PROVIDER MODEL\nsoloProvider' });
    expect(result).toBeNull();
  });

  it('deduplicates identical provider/model pairs', () => {
    const result = parsePiModels({ stdout: 'PROVIDER MODEL\nopenai gpt-4\nopenai gpt-4' });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-4', label: 'openai/gpt-4' },
    ]);
  });

  it('returns null when only the header line is present (no data rows)', () => {
    expect(parsePiModels({ stdout: 'PROVIDER MODEL' })).toBeNull();
  });

  it('handles extra whitespace between columns', () => {
    const result = parsePiModels({ stdout: 'PROVIDER   MODEL\nopenai     gpt-4   extra-column' });
    expect(result?.[1]).toEqual({ id: 'openai/gpt-4', label: 'openai/gpt-4' });
  });

  it('coerces a non-string stdout value via String()', () => {
    expect(parsePiModels({ stdout: 123 })).toBeNull();
  });
});

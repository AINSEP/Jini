import { describe, expect, it } from 'vitest';
import { parsePiModels } from '../pi-models.js';

describe('parsePiModels', () => {
  it('returns null for empty/whitespace-only stdout', () => {
    expect(parsePiModels({ stdout: '' })).toBeNull();
    expect(parsePiModels({ stdout: '   \n  \n' })).toBeNull();
    expect(parsePiModels({ stdout: undefined })).toBeNull();
    expect(parsePiModels({ stdout: null })).toBeNull();
  });

  it('coerces a non-string value via String()', () => {
    expect(parsePiModels({ stdout: 123 as unknown as string })).toBeNull();
  });

  it('skips comment lines starting with #', () => {
    const stdout = '# header comment\nPROVIDER MODEL\nopenai gpt-5';
    const result = parsePiModels({ stdout: stdout });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    ]);
  });

  it('treats the first non-comment line as a header and skips it', () => {
    const stdout = 'PROVIDER MODEL\nanthropic claude-4';
    const result = parsePiModels({ stdout: stdout });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'anthropic/claude-4', label: 'anthropic/claude-4' },
    ]);
  });

  it('returns null when only a header line is present (no data rows)', () => {
    expect(parsePiModels({ stdout: 'PROVIDER MODEL' })).toBeNull();
  });

  it('skips malformed rows with fewer than 2 columns', () => {
    const stdout = 'HEADER\nopenai\nanthropic claude-4';
    const result = parsePiModels({ stdout: stdout });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'anthropic/claude-4', label: 'anthropic/claude-4' },
    ]);
  });

  it('deduplicates repeated provider/model pairs', () => {
    const stdout = 'HEADER\nopenai gpt-5\nopenai gpt-5\nopenai gpt-5-mini';
    const result = parsePiModels({ stdout: stdout });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
      { id: 'openai/gpt-5-mini', label: 'openai/gpt-5-mini' },
    ]);
  });

  it('trims each line and tolerates extra whitespace between columns', () => {
    const stdout = '  HEADER  \n  openai    gpt-5   extra-col  ';
    const result = parsePiModels({ stdout: stdout });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    ]);
  });

  it('ignores blank lines interspersed between data rows', () => {
    const stdout = 'HEADER\n\nopenai gpt-5\n\n\nanthropic claude-4\n';
    const result = parsePiModels({ stdout: stdout });
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
      { id: 'anthropic/claude-4', label: 'anthropic/claude-4' },
    ]);
  });
});

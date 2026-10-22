import { describe, expect, it } from 'vitest';
import { createToolResultDiagnosticProjection } from '../tool-result-diagnostics.js';

describe('tool result diagnostic projection', () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'UNIQUE_PIXELS' };
  const frame = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'C', content: [image, { type: 'text', text: 'caption' }] }] } });
  it('projects only complete frames, including frames split inside the image data', () => {
    const projector = createToolResultDiagnosticProjection({});
    const cut = frame.indexOf('UNIQUE_PIXELS') + 4;
    expect(projector.feed({ chunk: frame.slice(0, cut) })).toBe('');
    const diagnostic = projector.feed({ chunk: frame.slice(cut) + '\nordinary stdout\n' });
    expect(diagnostic).not.toContain('UNIQUE_PIXELS');
    expect(diagnostic).toContain('[image image/png; 13 base64 characters]');
    expect(diagnostic).toContain('caption');
    expect(diagnostic.endsWith('ordinary stdout\n')).toBe(true);
    expect(projector.flush({})).toBe('');
  });
  it('handles Claude source images and JSON-stringified tool content on close', () => {
    const projector = createToolResultDiagnosticProjection({});
    const content = JSON.stringify({ content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'UNIQUE_PIXELS' } }] });
    expect(projector.feed({ chunk: JSON.stringify({ content }) })).toBe('');
    const diagnostic = projector.flush({});
    expect(diagnostic).not.toContain('UNIQUE_PIXELS');
    expect(diagnostic).toContain('image/png');
  });
  it('preserves unrecognized fields, ordinary text and malformed trailing output', () => {
    const projector = createToolResultDiagnosticProjection({});
    expect(projector.feed({ chunk: 'not json\n{"data":"ordinary","type":"record"}\n' })).toBe('not json\n{"data":"ordinary","type":"record"}\n');
    projector.feed({ chunk: '{incomplete' });
    expect(projector.flush({})).toBe('{incomplete');
  });
  it('bounds incomplete frames and resumes after the oversized frame newline', () => {
    const projector = createToolResultDiagnosticProjection({}, { maxFrameChars: 8 });
    expect(projector.feed({ chunk: '0123456789' })).toBe('');
    expect(projector.feed({ chunk: 'more\nokay\n' })).toBe('[diagnostic frame exceeded image projection limit]\nokay\n');
  });
});

import { describe, expect, it } from 'vitest';
import { renderUsage } from '../usage.js';

describe('renderUsage', () => {
  it('renders usage lines only', () => {
    expect(renderUsage({ usage: ['cmd sub <id>'] })).toBe('Usage:\n  cmd sub <id>');
  });

  it('renders multiple usage lines', () => {
    expect(renderUsage({ usage: ['cmd a', 'cmd b'] })).toBe('Usage:\n  cmd a\n  cmd b');
  });

  it('includes a description block when given', () => {
    expect(renderUsage({ usage: ['cmd'] }, { description: 'Does a thing.' })).toBe(
      'Usage:\n  cmd\n\nDoes a thing.',
    );
  });

  it('omits the description block when it is an empty string', () => {
    expect(renderUsage({ usage: ['cmd'] }, { description: '' })).toBe('Usage:\n  cmd');
  });

  it('renders an aligned options list when given', () => {
    const result = renderUsage({ usage: ['cmd'] }, { options: [
        { flag: '--json', description: 'Emit JSON.' },
        { flag: '--daemon-url <url>', description: 'Override the daemon URL.' },
      ] });
    const longest = '--daemon-url <url>'.length;
    const expected = [
      'Usage:',
      '  cmd',
      '',
      'Options:',
      `  ${'--json'.padEnd(longest)}  Emit JSON.`,
      `  ${'--daemon-url <url>'.padEnd(longest)}  Override the daemon URL.`,
    ].join('\n');
    expect(result).toBe(expected);
  });

  it('omits the options block when the list is empty', () => {
    expect(renderUsage({ usage: ['cmd'] }, { options: [] })).toBe('Usage:\n  cmd');
  });

  it('renders description and options together', () => {
    const result = renderUsage({ usage: ['cmd'] }, { description: 'Prose.', options: [{ flag: '--json', description: 'Emit JSON.' }] });
    expect(result).toBe('Usage:\n  cmd\n\nProse.\n\nOptions:\n  --json  Emit JSON.');
  });
});

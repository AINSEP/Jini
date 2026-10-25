import { describe, expect, it } from 'vitest';
import { sanitizeUntrustedText, stripControlSequences } from '../index.js';

// Construct actual control bytes, independent of escape transcription.
const ESC = String.fromCharCode(0x1b);

describe('sanitizeUntrustedText', () => {
  it.each([
    'five-coffee-brewing-tips',
    'agent_plugin_cloudflare',
    'release-2026-10-25-notes',
    'abcdefghijklmno-abcdefghijklm-a',
  ])('keepIdentifiers keeps the identifier-shaped run %s, which the default masks', token => {
    expect(sanitizeUntrustedText({ text: `slug ${token}` }, { keepIdentifiers: true })).toBe(`slug ${token}`);
    expect(sanitizeUntrustedText({ text: `slug ${token}` })).toBe('slug [redacted]');
  });

  it.each([
    '123e4567-e89b-12d3-a456-426614174000',
    'deadbeef0123456789abcdef01234567',
    `ghp_${'a1B2'.repeat(9)}`,
    `sk-proj-${'abc123'.repeat(4)}`,
    'Five-Coffee-Brewing-Tips-Today',
    'abc123def456ghi789jkl',
    'plugin_a1b2c3d4e5f6g7h8',
    'onlyonelongwordwithoutseparators',
    'correct-horse-battery-staple-orbit',
    'abcdefghij-klmnopqrst-uvwxyzabcd',
    '12345678_87654321_11223344',
    'abcdefghijklmnop-tool-id',
    'tool-1234567890123456-id',
  ])('keepIdentifiers still masks the opaque or credential-shaped run %s', token => {
    expect(sanitizeUntrustedText({ text: `failed ${token}` }, { keepIdentifiers: true })).toBe('failed [redacted]');
  });

  it('masks known and labelled credentials even when they are identifier-shaped', () => {
    const secret = 'known-opaque-credential-value';
    expect(sanitizeUntrustedText({ text: `${secret} api_key=agent_plugin_cloudflare` }, { keepIdentifiers: true, exactSecrets: [secret] }))
      .toBe('[redacted] api_key=[redacted]');
  });

  it('retains exact recovery hints and schema keywords, masking unknown identifiers', () => {
    const text = 'Call settings_list_definitions to see valid keys. additionalProperties assistant_ask_choice forms_create_definition source_control_get_capabilities pages_write_region someVeryLongReadableIdentifier a_long_readable_identifier';
    expect(sanitizeUntrustedText({ text }, { diagnosticToolIds: ['settings_list_definitions', 'assistant_ask_choice', 'forms_create_definition', 'source_control_get_capabilities'] })).toBe('Call settings_list_definitions to see valid keys. additionalProperties assistant_ask_choice forms_create_definition source_control_get_capabilities pages_write_region [redacted] [redacted]');
  });

  it('still redacts opaque, vendor and labelled secrets even when their values look like identifiers', () => {
    const token = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
    const text = `failed ${token} sk-proj-${token} api_key=settings_list_definitions Authorization: Bearer ${token}`;
    const result = sanitizeUntrustedText({ text });
    expect(result).not.toContain(token);
    expect(result).not.toContain('settings_list_definitions');
    expect(result).not.toContain('Bearer');
    expect(result).toContain('[redacted]');
  });

  it('exempts only exact registered IDs, after credential redaction', () => {
    const id = 'forms_create_definition';
    const suffix = 'deadbeefcafebabefeedfaceabcdefab';
    const vendor = `sk-proj-${suffix}`;
    const text = `${id} ${id}${suffix} ${id}_${suffix} api_key=${id} ${vendor}`;
    expect(sanitizeUntrustedText({ text }, { diagnosticToolIds: [id, vendor] }))
      .toBe(`${id} [redacted] [redacted] api_key=[redacted] [redacted]`);
    expect(sanitizeUntrustedText({ text: id })).toBe('[redacted]');
  });

  it('preserves complete trusted dotted IDs without exempting components or glued secrets', () => {
    const id = 'content_read.backup_restore_point';
    const opaque = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
    const vendor = `sk-proj-${opaque}`;
    const text = `Call ${id}. ${id}_${opaque} x${id} ${id}.${opaque} other.${id} backup_restore_point api_key=${id} ${vendor} ${opaque}`;
    expect(sanitizeUntrustedText({ text }, { diagnosticToolIds: [id, vendor] }))
      .toBe(`Call ${id}. content_read.[redacted] xcontent_read.[redacted] content_read.[redacted].[redacted] other.content_read.[redacted] [redacted] api_key=[redacted] [redacted] [redacted]`);
    expect(sanitizeUntrustedText({ text: id })).toBe('content_read.[redacted]');
  });

  it('keeps failure addresses, paths and emails visible', () => {
    const text = 'connect ECONNREFUSED 127.0.0.1:3000 /tmp/settings.ts owner@example.com';
    expect(sanitizeUntrustedText({ text })).toBe(text);
  });
  it('strips control sequences and redacts secrets in one pass', () => {
    const secret = 'B'.repeat(25);
    const result = sanitizeUntrustedText({ text: `${ESC}[31m${secret}${ESC}[0m` });
    expect(result).not.toContain(ESC);
    expect(result).not.toContain(secret);
  });

  it('returns short, clean text unchanged', () => {
    expect(sanitizeUntrustedText({ text: 'all good here' })).toBe('all good here');
  });

  it('truncates text past the default 500-character cap with a visible marker', () => {
    const long = 'word '.repeat(200); // 1000 chars, no long alnum run to redact
    const result = sanitizeUntrustedText({ text: long });
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('truncated');
  });

  it('honors a custom maxLength', () => {
    const result = sanitizeUntrustedText({ text: 'word '.repeat(50) }, { maxLength: 20 });
    expect(result).toBe('word wo… [truncated]');
    expect(result.length).toBe(20);
    expect(result).toContain('truncated');
  });
});


describe('sanitizer boundary cases', () => {
  it.each([0, 1, 5, 13, 20])('includes the truncation marker within a %i-character budget', maxLength => {
    const result = sanitizeUntrustedText({ text: 'word '.repeat(200) }, { maxLength });
    expect(result.length).toBe(maxLength);
    expect(result).toBe(maxLength < 13 ? '… [truncated]'.slice(0, maxLength)
      : `${'word '.repeat(200).slice(0, maxLength - 13)}… [truncated]`);
  });

  it('normalizes negative, fractional and non-finite length limits', () => {
    expect(sanitizeUntrustedText({ text: 'words' }, { maxLength: -1 })).toBe('');
    expect(sanitizeUntrustedText({ text: 'words' }, { maxLength: 2.9 })).toBe('… ');
    for (const maxLength of [NaN, Infinity, -Infinity]) {
      expect(sanitizeUntrustedText({ text: 'word '.repeat(200) }, { maxLength }).length).toBe(500);
    }
  });

  it('strips CSI, OSC terminated by BEL or ST, C0, DEL and C1 while keeping whitespace', () => {
    const bel = String.fromCharCode(7);
    expect(sanitizeUntrustedText({ text: `${ESC}]0;title${bel}rest` })).toBe('rest');
    expect(sanitizeUntrustedText({ text: `${ESC}]0;title${ESC}\\rest` })).toBe('rest');
    expect(sanitizeUntrustedText({ text: `a${String.fromCharCode(0, 127, 155)}b\tc\nd\re` })).toBe('ab\tc\nd\re');
  });

  it('retains correlation IDs and the route, but masks a glued secret', () => {
    expect(sanitizeUntrustedText({ text: 'ERR-AAAA-1111-BBBB-2222 delegated-tool-calls' }))
      .toBe('ERR-AAAA-1111-BBBB-2222 delegated-tool-calls');
    expect(sanitizeUntrustedText({ text: 'ERR-AAAA-1111-BBBB-2222ffff' })).toBe('[redacted]');
  });
});

const BEL = String.fromCharCode(0x07);
describe('stripControlSequences', () => {
  // PARITY
  it('leaves plain text untouched', () => {
    expect(stripControlSequences({ text: 'hello world' })).toBe('hello world');
  });

  // PARITY
  it('strips a CSI (color) escape sequence', () => {
    expect(stripControlSequences({ text: `${ESC}[31mred${ESC}[0m text` })).toBe('red text');
  });

  // PARITY
  it('strips an OSC sequence terminated by BEL', () => {
    expect(stripControlSequences({ text: `${ESC}]0;window title${BEL}rest` })).toBe('rest');
  });

  // PARITY
  it('strips an OSC sequence terminated by ESC \\\\ (ST)', () => {
    expect(stripControlSequences({ text: `${ESC}]0;window title${ESC}\\rest` })).toBe('rest');
  });

  // PARITY
  it('strips a bare/unrecognized ESC-prefixed byte', () => {
    expect(stripControlSequences({ text: `before${ESC}Xafter` })).toBe('beforeXafter');
  });

  // PARITY
  it('strips other C0 control characters but keeps tab/newline/carriage-return', () => {
    const withControls = `a${String.fromCharCode(0x00)}b${String.fromCharCode(0x07)}c\td\ne\rf`;
    expect(stripControlSequences({ text: withControls })).toBe('abc\td\ne\rf');
  });

  // PARITY
  it('strips DEL and C1 control characters', () => {
    const withControls = `a${String.fromCharCode(0x7f)}b${String.fromCharCode(0x9b)}c`;
    expect(stripControlSequences({ text: withControls })).toBe('abc');
  });
});

it('keeps UPPER_SNAKE diagnostic codes but masks credential-shaped and labelled code values', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123';
  const opaque = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
  const result = sanitizeUntrustedText({ text: `TOOL_OPERATION_DENIED DEFINITION_NOT_FOUND api_key=TOOL_OPERATION_DENIED Bearer DEFINITION_NOT_FOUND AKIAABCDEFGHIJKLMNOP ${jwt} ${opaque}` });
  expect(result).toBe('TOOL_OPERATION_DENIED DEFINITION_NOT_FOUND api_key=[redacted] Bearer [redacted] [redacted] [redacted] [redacted]');
});

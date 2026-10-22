import { describe, expect, it } from 'vitest';
import { adminThemeColorKeys, validateAdminTheme } from '../../theme/validation.js';
import type { AdminTheme, AdminThemeColors } from '../../theme/types.js';

const palette: AdminThemeColors = {
  primary: '#123456', primaryInk: '#fff', bg: '#ffffffff', surface: 'rgb(1, 2, 3)', text: 'hsl(10deg 20% 30% / 0.5)',
  muted: 'oklch(.5 0.1 120)', border: 'gray', danger: 'red', success: 'GREEN', warning: 'transparent',
};
const valid: AdminTheme = { name: 'Neutral', fonts: { body: 'Inter, sans-serif', heading: 'Inter' }, light: palette, dark: palette };
const theme = (patch: Record<string, unknown>): Record<string, unknown> => ({ ...valid, ...patch });
const errorsOf = (value: unknown): readonly string[] => {
  const result = validateAdminTheme({ theme: value });
  return result.valid ? [] : result.errors;
};

describe('validateAdminTheme', () => {
  it('accepts a complete theme and returns it unchanged', () => {
    expect(validateAdminTheme({ theme: valid })).toEqual({ valid: true, theme: valid });
  });

  it('accepts every optional field at its boundary', () => {
    const full = theme({ fonts: { ...valid.fonts, mono: 'monospace', load: ['/fonts.css', 'https://cdn.test/a.css'] }, radius: '0', density: 0.5 });
    expect(validateAdminTheme({ theme: full })).toEqual({ valid: true, theme: full });
    expect(errorsOf(theme({ radius: '1.5rem', density: 2 }))).toEqual([]);
    expect(errorsOf(theme({ fonts: { ...valid.fonts, load: Array.from({ length: 16 }, () => '/a.css') } }))).toEqual([]);
  });

  it.each([null, 'theme', [valid], 3])('refuses non-object theme %j with a single error', (value) => {
    expect(validateAdminTheme({ theme: value })).toEqual({ valid: false, errors: ['Theme must be an object'] });
  });

  it.each([undefined, '', '   ', 'a;b', 'a{', 'a<b', 'a\\b', 'a\nb', 'url(x)', 'a/*b', 'x'.repeat(513)])('refuses unsafe name %j', (name) => {
    expect(errorsOf(theme({ name }))).toEqual(['name must be a nonempty safe string']);
  });

  it('accepts a name at the 512-character limit', () => {
    expect(errorsOf(theme({ name: 'x'.repeat(512) }))).toEqual([]);
  });

  it.each([
    ['missing fonts', undefined],
    ['array fonts', []],
    ['missing body', { heading: 'a' }],
    ['missing heading', { body: 'a' }],
    ['unsafe mono', { body: 'a', heading: 'a', mono: '' }],
  ])('refuses fonts: %s', (_label, fonts) => {
    expect(errorsOf(theme({ fonts }))).toEqual(['fonts must provide body and heading font stacks']);
  });

  it.each([
    ['not an array', 'https://a.test/x.css'],
    ['too many', Array.from({ length: 17 }, () => '/a.css')],
    ['non-string', [1]],
    ['http URL', ['http://a.test/x.css']],
    ['javascript URL', ['javascript:alert(1)']],
    ['contains space', ['/a b.css']],
    ['contains angle bracket', ['/a<b.css']],
    ['too long', [`/${'a'.repeat(4096)}`]],
    ['unparseable', ['https://']],
  ])('refuses fonts.load: %s', (_label, load) => {
    expect(errorsOf(theme({ fonts: { ...valid.fonts, load } }))).toEqual(['fonts.load must contain relative or HTTPS stylesheet URLs']);
  });

  it('reports both font errors when stacks are bad and load is bad', () => {
    expect(errorsOf(theme({ fonts: { body: '', heading: 'a', load: 'x' } }))).toEqual([
      'fonts must provide body and heading font stacks',
      'fonts.load must contain relative or HTTPS stylesheet URLs',
    ]);
  });

  it.each([undefined, 'dark', []])('refuses a non-object light palette %j', (light) => {
    expect(errorsOf(theme({ light }))).toEqual(['light must be a complete palette']);
  });

  it('refuses a non-object dark palette', () => {
    expect(errorsOf(theme({ dark: null }))).toEqual(['dark must be a complete palette']);
  });

  it('reports every missing key of an empty palette in key order', () => {
    expect(errorsOf(theme({ dark: {} }))).toEqual(adminThemeColorKeys.map((key) => `dark.${key} must be a concrete CSS color`));
  });

  it('refuses an inherited (non-own) color key', () => {
    const { primary, ...rest } = palette;
    const inherited = Object.assign(Object.create({ primary }) as object, rest);
    expect(errorsOf(theme({ light: inherited }))).toEqual(['light.primary must be a concrete CSS color']);
  });

  it.each([
    '#12', '#12345', '#1234567', '#ggg', 'var(--x)', 'url(a)', 'rgb(1,2)', 'rgb(1 2 3 4 5)', 'rgb(1,\n2,3)',
    'purple', 'calc(1px)', 7, '',
  ])('refuses non-concrete color %j', (primary) => {
    expect(errorsOf(theme({ light: { ...palette, primary } }))).toEqual(['light.primary must be a concrete CSS color']);
  });

  it.each(['#abc', '#abcd', '#aabbcc', '#aabbccdd', 'rgba(1,2,3,0.5)', 'hsla(1, 2%, 3%, .5)', 'lab(50% none 3)', 'lch(1 2 3turn)', 'oklab(-0.1 +0.2 0.3)', 'GREY', 'Black', 'white', 'blue'])('accepts concrete color %j', (primary) => {
    expect(errorsOf(theme({ light: { ...palette, primary } }))).toEqual([]);
  });

  it('refuses unknown palette keys after the required-key errors', () => {
    expect(errorsOf(theme({ light: { ...palette, primary: 'bad', accent: '#fff' } }))).toEqual([
      'light.primary must be a concrete CSS color',
      'light.accent is not a theme color',
    ]);
  });

  it.each(['-1px', '1', '1pt', '.5rem', ' 1px', 4])('refuses radius %j', (radius) => {
    expect(errorsOf(theme({ radius }))).toEqual(['radius must be a nonnegative CSS length']);
  });

  it.each(['0.49', 0.49, 2.01, Number.NaN, Number.POSITIVE_INFINITY])('refuses density %j', (density) => {
    expect(errorsOf(theme({ density }))).toEqual(['density must be between 0.5 and 2']);
  });

  it('reports every failing section in order', () => {
    expect(errorsOf({ name: '', fonts: {}, light: 1, dark: 1, radius: 1, density: 9 })).toEqual([
      'name must be a nonempty safe string',
      'fonts must provide body and heading font stacks',
      'light must be a complete palette',
      'dark must be a complete palette',
      'radius must be a nonnegative CSS length',
      'density must be between 0.5 and 2',
    ]);
  });
});

import { expect, it, vi } from 'vitest';
import { defaultAdminTheme } from '../default.js';
import { renderAdminThemeVariables } from '../stylesheet.js';
import type { ColorScheme } from '../../core/theme/types.js';
import { resolveAnnotationTheme } from '../../renderers/annotation-canvas/theme.js';

it('gives an isolated preview concrete values from the same theme data', () => {
  const css = renderAdminThemeVariables({ theme: defaultAdminTheme }, { colorScheme: 'dark' });
  expect(css).toContain(`--jini-bg:${defaultAdminTheme.dark.bg};`);
  expect(css).toContain(`--jini-danger:${defaultAdminTheme.dark.danger};`);
  expect(css).toContain(`--jini-font-body:${defaultAdminTheme.fonts.body};`);
  expect(css).toContain('color-scheme:dark;');
  expect(() => renderAdminThemeVariables({ theme: { ...defaultAdminTheme, fonts: { body: '</style>', heading: 'system-ui' } } })).toThrow(TypeError);
});

it('resolves canvas drawing colors and font through an injected computed-style reader', () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const values: Record<string, string> = { '--jini-danger': 'rgb(200, 0, 0)', '--jini-primary': 'rgb(0, 100, 200)',
    '--jini-bg': 'rgb(20, 20, 20)', '--jini-primary-ink': 'rgb(255, 255, 255)', '--jini-font-body': 'Example, sans-serif' };
  const style = { getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration;
  const getComputedStyle = vi.fn(() => style);
  expect(resolveAnnotationTheme({ canvas }, { getComputedStyle })).toEqual({
    stroke: values['--jini-danger'], target: values['--jini-primary'], bg: values['--jini-bg'], ink: values['--jini-primary-ink'], font: values['--jini-font-body'],
  });
  expect(getComputedStyle).toHaveBeenCalledWith(canvas);
  canvas.remove();
  resolveAnnotationTheme({ canvas }, { getComputedStyle });
  expect(getComputedStyle).toHaveBeenLastCalledWith(document.documentElement);
});

it('fills an omitted mono font and radius from the default theme, and refuses an unresolved color scheme', () => {
  const { mono: _mono, ...fonts } = defaultAdminTheme.fonts;
  const { radius: _radius, ...theme } = defaultAdminTheme;
  const css = renderAdminThemeVariables({ theme: { ...theme, fonts } });
  expect(css).toContain(`--jini-font-mono:${defaultAdminTheme.fonts.mono};`);
  expect(css).toContain(`--jini-radius:${defaultAdminTheme.radius};`);
  expect(css.startsWith(':root{color-scheme:light;')).toBe(true);
  // An untyped persisted preference ('system') must be resolved to light/dark before an isolated
  // preview is rendered; the runtime check is the only guard for such a value.
  const persisted = 'system' as unknown as ColorScheme;
  expect(() => renderAdminThemeVariables({ theme: defaultAdminTheme }, { colorScheme: persisted })).toThrow('Invalid resolved color scheme');
});

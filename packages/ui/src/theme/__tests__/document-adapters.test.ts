import { expect, it, vi } from 'vitest';
import { defaultAdminTheme } from '../default.js';
import { renderAdminThemeVariables } from '../stylesheet.js';
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

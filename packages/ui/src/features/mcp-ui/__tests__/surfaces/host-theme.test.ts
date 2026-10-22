import { describe, expect, it } from 'vitest';
import { renderSurfaceDocument } from '../../surfaces/document.js';
import { applyHostSurfaceTokens, readHostSurfaceTokens } from '../../surfaces/host-theme.js';

const style = (values: Record<string, string>) => ({ getPropertyValue: (name: string) => values[name] ?? '' });

const surface = (tokens?: Record<string, string>) =>
  renderSurfaceDocument({
    title: 'Card',
    bodyHtml: '<p>hi</p>',
    script: '',
    app: { appName: 'test', appVersion: '1' },
    ...(tokens === undefined ? {} : { tokens }),
  });

describe('readHostSurfaceTokens', () => {
  it('maps the host primary and its ink onto the accent tokens and the neutrals onto their surface tokens', () => {
    const tokens = readHostSurfaceTokens(style({ '--jini-primary': ' oklch(55% 0.11 43) ', '--jini-primary-ink': '#111111', '--jini-surface': '#fafafa', '--jini-border': '#ddd' }));
    expect(tokens).toEqual({
      '--jini-mcpui-accent': 'oklch(55% 0.11 43)',
      '--jini-mcpui-accent-strong': 'oklch(55% 0.11 43)',
      '--jini-mcpui-accent-ink': '#111111',
      '--jini-mcpui-panel': '#fafafa',
      '--jini-mcpui-border': '#ddd',
      '--jini-mcpui-border-strong': '#ddd',
    });
  });

  it('omits undeclared variables, so the surface keeps its own default for them', () => {
    expect(readHostSurfaceTokens(style({}))).toEqual({});
  });

  it('drops a value that could break out of the style element or its declaration', () => {
    const tokens = readHostSurfaceTokens(style({ '--jini-primary': 'red</style><script>x()</script>', '--jini-text': 'red; --x: 1', '--jini-bg': '#fff' }));
    expect(tokens).toEqual({ '--jini-mcpui-bg': '#fff' });
  });
});

describe('applyHostSurfaceTokens', () => {
  it("paints a primary button's text with the accent ink the host supplies", () => {
    expect(surface()).toMatch(/\.mcpui-button-primary \{[^}]*color: var\(--jini-mcpui-accent-ink\);/);
  });

  it('inserts a :root rule right after the token style, so it outranks the defaults by source order', () => {
    const html = applyHostSurfaceTokens(surface(), { '--jini-mcpui-accent': '#a85a38' });
    const tokenBlockEnd = html.indexOf('</style>');
    const hostRule = html.indexOf('<style data-jini-host-theme>');
    expect(hostRule).toBeGreaterThan(tokenBlockEnd);
    expect(html.slice(hostRule)).toMatch(/^<style data-jini-host-theme>\n:root \{\n {2}--jini-mcpui-accent: #a85a38;\n\}\n<\/style>/);
  });

  it("leaves a builder's own tokens in the more specific :root:root rule, which the host rule cannot outrank", () => {
    const html = applyHostSurfaceTokens(surface({ '--jini-mcpui-accent': '#00aa88' }), { '--jini-mcpui-accent': '#a85a38' });
    expect(html).toContain(':root:root {\n  --jini-mcpui-accent: #00aa88;\n}');
  });

  it('returns the document unchanged with no tokens, no surface tokens, or no style element', () => {
    const doc = surface();
    expect(applyHostSurfaceTokens(doc, {})).toBe(doc);
    expect(applyHostSurfaceTokens('<style>p{}</style><p>third party</p>', { '--jini-mcpui-accent': '#a85a38' })).toBe('<style>p{}</style><p>third party</p>');
    expect(applyHostSurfaceTokens('<p style="--jini-mcpui-accent: red">x</p>', { '--jini-mcpui-accent': '#a85a38' })).toBe('<p style="--jini-mcpui-accent: red">x</p>');
  });
});

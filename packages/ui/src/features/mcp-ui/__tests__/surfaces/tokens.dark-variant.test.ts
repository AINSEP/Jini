import { describe, expect, it } from 'vitest';
import { SURFACE_TOKENS_DARK, renderTokenBlock } from '../../surfaces/tokens.js';

describe('renderTokenBlock dark variant (forceLight: false)', () => {
  const block = renderTokenBlock({}, { forceLight: false });
  const dark = block.slice(block.indexOf('@media (prefers-color-scheme: dark)'));

  it('appends a prefers-color-scheme: dark :root block after the light one', () => {
    expect(block.startsWith(':root {')).toBe(true);
    expect(dark.startsWith('@media (prefers-color-scheme: dark) {\n  :root {\n')).toBe(true);
    expect(block.endsWith('  }\n}')).toBe(true);
  });

  it('declares every dark base token and the fixed dark-ink surface shadow', () => {
    for (const [name, value] of Object.entries(SURFACE_TOKENS_DARK)) expect(dark).toContain(`  ${name}: ${value};`);
    expect(dark).toContain('--jini-mcpui-surface-shadow: 0 1px 2px color-mix(in srgb, var(--jini-mcpui-bg) 32%, transparent);');
  });

  it('leaves overridden tokens out of both schemes so the :root:root override wins in each', () => {
    const reskinned = renderTokenBlock({ '--jini-mcpui-accent': '#0055ff' }, { forceLight: false });
    const darkPart = reskinned.slice(reskinned.indexOf('@media'));
    expect(darkPart).not.toContain(`--jini-mcpui-accent: ${SURFACE_TOKENS_DARK['--jini-mcpui-accent']};`);
    expect(reskinned).toContain(':root:root {\n  --jini-mcpui-accent: #0055ff;\n}');
  });

  it('matches the default output exactly when forceLight is passed as true', () => {
    expect(renderTokenBlock({}, { forceLight: true })).toBe(renderTokenBlock());
  });
});

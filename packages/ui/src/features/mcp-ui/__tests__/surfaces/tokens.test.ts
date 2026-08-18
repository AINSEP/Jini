import { describe, expect, it } from 'vitest';
import { FORCE_LIGHT_SURFACE_THEME, SURFACE_TOKENS, SURFACE_TOKENS_DARK, renderTokenBlock } from '../../surfaces/tokens.js';

describe('renderTokenBlock', () => {
  const block = renderTokenBlock();

  it('declares every base token, so none can silently resolve to nothing in an isolated iframe', () => {
    for (const [name, value] of Object.entries(SURFACE_TOKENS)) {
      expect(block).toContain(`${name}: ${value};`);
    }
  });

  it('wraps the declarations in :root', () => {
    expect(block.startsWith(':root {')).toBe(true);
    expect(block.endsWith('}')).toBe(true);
  });

  it('derives hover, tint and ring shades with color-mix over the base tokens rather than second literals', () => {
    expect(block).toContain('--jini-mcpui-accent-hover: color-mix(in srgb, var(--jini-mcpui-accent) 88%, #000);');
    expect(block).toContain('--jini-mcpui-danger-hover: color-mix(in srgb, var(--jini-mcpui-danger) 88%, #000);');
    // Every derived value must resolve through a base token — that is what makes one override reskin
    // the whole ramp. A literal hex in a derived declaration would break that silently.
    const derived = block.split('\n').filter((line) => line.includes('color-mix'));
    expect(derived.length).toBeGreaterThan(0);
    for (const line of derived) expect(line).toContain('var(--jini-mcpui-');
  });

  it('applies overrides to base tokens while leaving derived ones pointing at them', () => {
    const reskinned = renderTokenBlock({ '--jini-mcpui-accent': '#0055ff' });
    expect(reskinned).toContain('--jini-mcpui-accent: #0055ff;');
    expect(reskinned).not.toContain('--jini-mcpui-accent: #c96442;');
    expect(reskinned).toContain('--jini-mcpui-accent-hover: color-mix(in srgb, var(--jini-mcpui-accent) 88%, #000);');
  });

  it('loads no external font — a sandboxed frame has no network to fetch one over', () => {
    expect(block).not.toContain('@import');
    expect(block).not.toContain('http');
    expect(SURFACE_TOKENS['--jini-mcpui-font']).toContain('-apple-system');
  });

  it('pins the light palette and drops the dark media query while FORCE_LIGHT_SURFACE_THEME is set', () => {
    // Tovu has no real app-level theme yet, so `prefers-color-scheme` would otherwise track the
    // operator's OS rather than any real Tovu setting — see FORCE_LIGHT_SURFACE_THEME's own doc.
    expect(FORCE_LIGHT_SURFACE_THEME).toBe(true);
    expect(block).not.toContain('@media (prefers-color-scheme: dark)');
    for (const [name, value] of Object.entries(SURFACE_TOKENS)) {
      expect(block).toContain(`${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(SURFACE_TOKENS_DARK)) {
      if (SURFACE_TOKENS[name as keyof typeof SURFACE_TOKENS] === value) continue;
      expect(block).not.toContain(`${name}: ${value};`);
    }
  });
});

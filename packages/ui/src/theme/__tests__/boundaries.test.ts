import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { defaultAdminTheme } from '../default.js';
import { adminThemeColorKeys } from '../validation.js';

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.name === '__tests__' || /\.test\./.test(entry.name)) return [];
    return entry.isDirectory() ? files(file) : /\.(?:ts|tsx|css)$/.test(file) ? [file] : [];
  });
}



it('keeps light/dark CSS defaults identical to the default theme data', () => {
  const css = readFileSync(path.resolve(__dirname, '../../styles/variables.css'), 'utf8');
  for (const scheme of ['light', 'dark'] as const) for (const key of adminThemeColorKeys) {
    const suffix = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    expect(css).toContain(`--jini-${suffix}: var(--jini-theme-${scheme}-${suffix}, ${defaultAdminTheme[scheme][key]});`);
  }
  expect(css).not.toContain('prefers-color-scheme');
});

it('rejects embedded palette and font literals outside the sole defaults', () => {
  // Color-picker options and document content are data; rendered CSS/JSX chrome must use variables.
  for (const file of files(path.resolve(__dirname, '../..')).filter((file) => /\.(?:tsx|css)$/.test(file))) {
    if (file.endsWith('/styles/variables.css')) continue;
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source, file).not.toMatch(/#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch)\(/i);
    expect(source, file).not.toMatch(/font(?:Family|\-family)\s*:\s*['"]?(?:ui-monospace|monospace|system-ui|sans-serif)/);
  }
});

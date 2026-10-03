import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('ships the theme subpath and both stylesheets while preserving legacy CSS entries', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
  expect(manifest.exports['./theme']).toEqual({ types: './dist/theme/index.d.ts', import: './dist/theme/index.js', default: './dist/theme/index.js' });
  expect(manifest.exports['./styles/*']).toBe('./dist/styles/*');
  expect(manifest.jini.entries['./styles/*']).toBe('browser');
  expect(manifest.sideEffects).toContain('./dist/styles/*.css');
  expect(manifest.scripts.build).toContain('cp src/styles/*.css dist/styles/');
  for (const subpath of ['./admin-widgets.css', './tabbed-dialog.css', './settings-dialog.css']) {
    expect(typeof manifest.exports[subpath]).toBe('string');
  }
  const wrapper = readFileSync(path.resolve(__dirname, '../../features/admin-widgets/styles/admin-widgets.css'), 'utf8');
  expect(wrapper).toContain('@import "../../../styles/admin.css";');
});

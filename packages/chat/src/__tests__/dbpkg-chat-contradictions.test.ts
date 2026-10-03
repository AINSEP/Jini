import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { RendererRegistry, type ArtifactRenderer } from '../react/artifact-types.js';

it('keeps newest renderer priority and restores the previous match after unregister', () => {
  const registry = new RendererRegistry();
  const first: ArtifactRenderer = { id: 'first', supportsStreaming: false, canRender: () => true };
  const second: ArtifactRenderer = { id: 'second', supportsStreaming: false, canRender: () => true };
  registry.register(first);
  const unregister = registry.register(second);
  const context = { file: { name: 'answer.txt', kind: 'text' } };
  expect(registry.resolve(context)).toEqual({ renderer: second, file: context.file });
  unregister();
  expect(registry.resolve(context)).toEqual({ renderer: first, file: context.file });
  unregister();
  expect(registry.list()).toEqual([first]);
});

it('exposes the structural reference stylesheet as an opt-in export', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports['./react/styles/reference.css']).toBe('./dist/react/styles/reference.css');
  expect(manifest.jini.entries['./react/styles/reference.css']).toBe('browser');
  const css = readFileSync(new URL('../react/styles/reference.css', import.meta.url), 'utf8');
  expect(css).toContain('Not applied by default');
  expect(css).toContain('exported for opt-in use');
  expect(css).toContain('.jini-chat-pane__controls');
  expect(css).toContain('.jini-chat-pane__drop-target');
});

import { expect, it, vi } from 'vitest';
import { exportHtml } from '../export-html-policy.js';

it('strip runs before identity edits and unrelated bytes survive', () => {
  const html = '<!doctype html>\n<head><link rel="canonical" href="/old"></head>\n<body data-theme="unchanged">  text &amp; spaces </body>';
  const stripNativeFormTools = vi.fn(({ html }: { html: string }) => html.replace('/old', '/after-strip'));
  expect(exportHtml({ html, publicOrigin: 'https://site.example', stripNativeFormTools })).toBe(html.replace('/old', 'https://site.example/after-strip'));
  expect(stripNativeFormTools).toHaveBeenCalledWith({ html });
});

import { expect, it, vi } from 'vitest';
import { exportHtml } from '../export-html-policy.js';

it('strip runs before identity edits and unrelated bytes survive', () => {
  const html = '<!doctype html>\n<head><link rel="canonical" href="/old"></head>\n<body data-theme="unchanged">  text &amp; spaces </body>';
  const stripNativeFormTools = vi.fn(({ html }: { html: string }) => html.replace('/old', '/after-strip'));
  expect(exportHtml({ html, publicOrigin: 'https://site.example', stripNativeFormTools })).toBe(html.replace('/old', 'https://site.example/after-strip'));
  expect(stripNativeFormTools).toHaveBeenCalledWith({ html });
});

it('omits discovery and public identity without an origin while preserving root-relative social images', () => {
  const html = '<head><link rel="CANONICAL alternate" href="/about"><link rel="alternate" href="/feed.xml?format=rss"><link href="/sitemap.xml#top"><meta property="og:url" content="/about"><meta name="twitter:image" content="//images.example/remote.png"><meta property="og:image" content="/photo.png"><meta name="twitter:image"><link rel="stylesheet" href="/theme.css"><meta name="description" content="Keeping this"></head>';
  expect(exportHtml({ html, stripNativeFormTools: input => input.html })).toBe(
    '<head><meta property="og:image" content="/photo.png"><link rel="stylesheet" href="/theme.css"><meta name="description" content="Keeping this"></head>',
  );
});

it('removes nested JSON-LD identities, preserves data and omits malformed blocks', () => {
  const html = '<head><script type="APPLICATION/LD+JSON">[{"@id":"/root","url":"/root","name":"Tea < Coffee","offers":[{"url":"/buy","price":5},null,false]}]</script><script type="application/ld+json">{not-json}</script><script type="application/json">{"url":"/theme"}</script></head>';
  expect(exportHtml({ html, stripNativeFormTools: input => input.html })).toBe(
    '<head><script type="APPLICATION/LD+JSON">[{"name":"Tea \\u003c Coffee","offers":[{"price":5},null,false]}]</script><script type="application/json">{"url":"/theme"}</script></head>',
  );
});

it('expands root-relative Open Graph identity without replacing an absolute canonical override', () => {
  const html = '<head><meta name="OG:URL" content="/shop?color=red&amp;size=m"><link rel="canonical" href="https://editorial.example/shop"><link rel="canonical"><meta property="og:image" content="/photo.png"></head>';
  expect(exportHtml({ html, publicOrigin: 'https://shop.example', stripNativeFormTools: input => input.html })).toBe(
    '<head><meta name="OG:URL" content="https://shop.example/shop?color=red&amp;size=m"><link rel="canonical" href="https://editorial.example/shop"><link rel="canonical"><meta property="og:image" content="/photo.png"></head>',
  );
});

it('edits source-located identity inside template content without reserializing the surrounding HTML', () => {
  const html = '<main>  ♥ <template data-theme="keep"><link rel="canonical" href="/card"><p data-slot="inner">  &amp;  </p></template> tail</main>';
  expect(exportHtml({ html, publicOrigin: 'https://shop.example', stripNativeFormTools: input => input.html })).toBe(
    '<main>  ♥ <template data-theme="keep"><link rel="canonical" href="https://shop.example/card"><p data-slot="inner">  &amp;  </p></template> tail</main>',
  );
});

it('keeps an href-less non-canonical link, and leaves an unterminated trailing JSON-LD block byte-for-byte because it has no end tag to edit between', () => {
  const html = '<head><link rel="preconnect"><link rel="icon" href="/favicon.ico"></head><body><script type="application/ld+json">{"url":"/kept","name":"Tail"}';
  expect(exportHtml({ html, stripNativeFormTools: input => input.html })).toBe(html);
});

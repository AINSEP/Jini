import { expect, it } from 'vitest';
import { gateConsentHtml } from '../html/index.js';
import { config } from './fixtures.js';

const gate = (html: string, options: Parameters<typeof gateConsentHtml>[1] = {}) => gateConsentHtml({
  html, config, record: null, regionMode: 'opt-in', gpc: false, endpoint: '/consent',
}, options);

it('removes an unparseable external preload instead of treating it as trusted', () => {
  const html = gate('<html><head><link rel="preload" href="https://[" as="script"></head><body>Page</body></html>');
  expect(html).not.toContain('href="https://["');
  expect(html).toContain('Page');
});

it('matches reviewed inline speculation-rule bytes exactly while retaining optional labels', () => {
  const reviewed = '{"prerender":[{"source":"list","urls":["/next"]}]}';
  const allowed = `<script type="speculationrules">${reviewed}</script>`;
  const optional = `<script type="speculationrules" data-consent-category="analytics">${reviewed}</script>`;
  const html = gate(allowed + optional, { necessaryScripts: [{ content: reviewed }] });
  expect(html).toContain(allowed);
  expect(html).toContain(`<template data-jini-consent-script data-category="analytics">${optional}</template>`);
});

it('keeps optional labels inside a foreign template under the enclosing subtree requirement', () => {
  const html = gate('<div data-consent-category="functional"><svg><template data-consent-category="analytics"><text>Tracked</text></template></svg></div>');
  expect(html).toContain('<template data-jini-consent-resource data-category="analytics"><div');
  expect(html).toContain('Tracked');
});

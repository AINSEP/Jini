import { describe, it, expect } from 'vitest';
import { taxonomyHtmlEmbed } from '../html-rules.js';

function embedConfig(html: string): unknown {
  const match = /^<div data-embed-config='(.*)'><\/div>$/.exec(html);
  if (!match) throw new Error(`unexpected embed markup: ${html}`);
  return JSON.parse((match[1] ?? '').replace(/&#39;/g, "'"));
}

describe('taxonomyHtmlEmbed', () => {
  it('references a taxonomy by its name when that name is unique', () => {
    const taxonomy = { id: 'tax-1', name: 'Topics' };
    const html = taxonomyHtmlEmbed({ taxonomy, taxonomies: [taxonomy, { id: 'tax-2', name: 'Tags' }] });
    expect(html).toBe(`<div data-embed-config='{"type":"taxonomy","id":"Topics","mode":"html"}'></div>`);
  });

  it('falls back to the id when another taxonomy shares the name', () => {
    const taxonomy = { id: 'tax-1', name: 'Topics' };
    const html = taxonomyHtmlEmbed({ taxonomy, taxonomies: [taxonomy, { id: 'tax-2', name: 'Topics' }] });
    expect(embedConfig(html)).toEqual({ type: 'taxonomy', id: 'tax-1', mode: 'html' });
  });

  it("falls back to the id when the name equals a different taxonomy's id", () => {
    const taxonomy = { id: 'tax-1', name: 'tax-2' };
    const html = taxonomyHtmlEmbed({ taxonomy, taxonomies: [taxonomy, { id: 'tax-2', name: 'Other' }] });
    expect(embedConfig(html)).toEqual({ type: 'taxonomy', id: 'tax-1', mode: 'html' });
  });

  it('keeps the name when it only equals its own id', () => {
    const taxonomy = { id: 'Topics', name: 'Topics' };
    expect(embedConfig(taxonomyHtmlEmbed({ taxonomy, taxonomies: [taxonomy] }))).toEqual({
      type: 'taxonomy',
      id: 'Topics',
      mode: 'html',
    });
  });

  it("escapes single quotes so the attribute's quoting holds", () => {
    const taxonomy = { id: 'tax-1', name: "Editor's picks" };
    const html = taxonomyHtmlEmbed({ taxonomy, taxonomies: [taxonomy] });
    expect(html).toContain('Editor&#39;s picks');
    expect(html.slice("<div data-embed-config='".length, -"'></div>".length)).not.toContain("'");
    expect(embedConfig(html)).toEqual({ type: 'taxonomy', id: "Editor's picks", mode: 'html' });
  });
});

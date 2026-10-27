import { describe, expect, it } from 'vitest';
import { gateConsentHtml, renderConsentHead } from '../html/index.js';
import { cssRequestsRemote } from '../html/resources.js';
import { config } from './fixtures.js';

const gate = (html: string) => gateConsentHtml({ html, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });

describe('gateConsentHtml attribute edges', () => {
  it('refuses a page whose reserved ID sits on a parser-cloned formatting element with no source of its own', () => {
    // `<b>` misnested across `<p>` is cloned by the adoption agency; the clone carries the reserved ID but
    // has no source span to remove it from, so delivering the page would shadow the consent UI.
    expect(() => gate('<!doctype html><html><head></head><body><b id="jini-consent"><p>text</b>more</p></body></html>'))
      .toThrow('Consent could not locate the "id" attribute of <b> in the delivered HTML. Serve this page under the restrictive consent fallback.');
  });

  it('keeps a link whose href the URL parser rejects: it cannot be a javascript: URL', () => {
    const out = gate('<!doctype html><html><head></head><body><a href="http://[">bad url</a></body></html>');
    expect(out).toContain('<a href="http://[">bad url</a>');
    expect(gate('<!doctype html><html><head></head><body><a href="javascript:track()">js</a></body></html>')).not.toContain('<a href="javascript:track()">');
  });

  it('keeps a first-party handler on a foreign element whose other attributes were case-adjusted', () => {
    const out = gate('<!doctype html><html><head></head><body><svg viewbox="0 0 1 1" onload="track()"></svg></body></html>');
    expect(out).toContain('<svg viewbox="0 0 1 1"');
    expect(out).toMatch(/<svg[^>]*\sonload="track\(\)"/);
    expect(out).not.toContain('data-jini-consent-attributes=');
  });
});

describe('gateConsentHtml normalization that does not converge', () => {
  it('refuses a malformed page whose re-serialized form still carries a duplicate attribute (mutation-XSS shape)', () => {
    // The repeated <body> forces normalization. Parsed, the <style> is an HTML raw-text element
    // holding `<img … a=1 a=2>` as text; serialized, it sits under <mtext><mglyph>, where the
    // reparse treats it as MathML and reads that text as an <img> with a duplicate attribute. The
    // page never converges to one unambiguous form, so the gate refuses it instead of guessing.
    expect(() => gate('<body a=1><body b=2><math><mtext><table><mglyph><style><img src=x a=1 a=2>'))
      .toThrow('Consent could not normalize repeated root tags or duplicate attributes. Serve this page under the restrictive consent fallback.');
  });
});

describe('renderConsentHead origin contract', () => {
  it('rejects an origin the URL parser cannot read with the same exact-origin guidance', () => {
    expect(() => renderConsentHead({ record: null, gpc: false }, { resourceOrigins: ['cdn.example'] }))
      .toThrow('Consent resource origin "cdn.example" must be an exact HTTP(S) origin such as https://cdn.example (no path or trailing slash).');
  });
});

describe('cssRequestsRemote escapes and @import preludes', () => {
  it('C8: a closing parenthesis inside an image-set comment cannot conceal its remote candidate', () => {
    const css = 'a{background:image-set(/* "/a.png") */ "https://tags.example/pixel.png" 1x)}';
    expect(cssRequestsRemote({ css })).toBe(true);
  });

  it('decodes an escaped line continuation, so a split @import is still seen', () => {
    expect(cssRequestsRemote({ css: '@im\\\nport "https://t.example/a.css";' })).toBe(true);
    expect(cssRequestsRemote({ css: '@im\\\nport "/local.css";' })).toBe(false);
  });

  it('decodes NUL, surrogate and out-of-range escapes to U+FFFD, never to a local path character', () => {
    expect(cssRequestsRemote({ css: 'a{background:url(\\2f local.png)}' })).toBe(false);
    for (const escape of ['\\0 ', '\\d800 ', '\\110000 ']) {
      expect(cssRequestsRemote({ css: `a{background:url(${escape}local.png)}` }), escape).toBe(true);
    }
    // A private-use code point above the surrogate block is a real character, decoded as itself.
    expect(cssRequestsRemote({ css: 'a{background:url(/\\e000 .png)}' })).toBe(false);
  });

  it('reads single-quoted strings in @import and image-set()', () => {
    expect(cssRequestsRemote({ css: "@import 'https://t.example/a.css';" })).toBe(true);
    expect(cssRequestsRemote({ css: "@import '/local.css';" })).toBe(false);
    expect(cssRequestsRemote({ css: "a{background:image-set('/a.png' 1x, 'https://t.example/b.png' 2x)}" })).toBe(true);
    expect(cssRequestsRemote({ css: "a{background:image-set('/a.png' 1x)}" })).toBe(false);
  });

  it('accepts an @import that runs to the end of the text, and denies one left inside an open group', () => {
    expect(cssRequestsRemote({ css: '@import "/local.css"' })).toBe(false);
    expect(cssRequestsRemote({ css: '@import "/local.css" supports(display: grid' })).toBe(true);
  });

  it('denies an @import prelude that closes a group it never opened', () => {
    expect(cssRequestsRemote({ css: '@import ) "/local.css";' })).toBe(true);
  });

  it('accepts @import url(...) by its url() reference and denies a prelude naming nothing', () => {
    expect(cssRequestsRemote({ css: '@import url(/local.css);' })).toBe(false);
    expect(cssRequestsRemote({ css: '@import url(https://t.example/a.css);' })).toBe(true);
    expect(cssRequestsRemote({ css: '@import layer(base);' })).toBe(true);
  });
});

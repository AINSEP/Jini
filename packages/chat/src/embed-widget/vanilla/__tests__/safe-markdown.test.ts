import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { createSafeMarkdownRenderer } from '../safe-markdown.js';
import { createSafeMarkdownRenderer as exportedFromEntry } from '../index.js';

const doms: JSDOM[] = [];
/** A page at a real origin; `head` lets a test add a <base> element. */
function page({ url = 'https://site.example/blog/post', head = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head>${head}</head><body><div id="t"></div></body></html>`, { url });
  doms.push(dom);
  const document = dom.window.document;
  return { document, target: document.getElementById('t') as HTMLElement };
}
afterEach(() => { doms.splice(0).forEach(dom => dom.window.close()); });

/** The injected converter is trusted to emit escaped HTML; these tests hand it already-built HTML. */
const passthrough = ({ content }: { content: string }) => content;
const sources = (target: HTMLElement) => [...target.querySelectorAll('img')].map(image => image.getAttribute('src'));

describe('createSafeMarkdownRenderer', () => {
  it('is exported from the ./vanilla entry', () => {
    expect(exportedFromEntry).toBe(createSafeMarkdownRenderer);
  });

  it('a cross-origin, protocol-relative, data: or unparsable image never enters the DOM', () => {
    const { document, target } = page();
    const render = createSafeMarkdownRenderer({ toHtml: passthrough, document });
    render({ element: target, content: [
      '<p><img src="https://evil.example/x.png" alt="a">',
      '<img src="//evil.example/y.png" alt="b">',
      '<img src="data:image/png;base64,AAAA" alt="c">',
      '<img src="http://[::1" alt="d">',
      '<img alt="no source">',
      '<img src="http://site.example/downgrade.png" alt="other scheme">',
      'text</p>',
    ].join('') });
    expect(sources(target)).toEqual([]);
    expect(target.textContent).toBe('text');
  });

  it('same-origin relative and absolute images are kept', () => {
    const { document, target } = page();
    createSafeMarkdownRenderer({ toHtml: passthrough, document })({ element: target,
      content: '<p><img src="/a.png"><img src="b.png"><img src="https://site.example/c.png"></p>' });
    expect(sources(target)).toEqual(['/a.png', 'b.png', 'https://site.example/c.png']);
  });

  it('An external base element cannot authorize an external image', () => {
    const { document, target } = page({ head: '<base href="https://evil.example/">' });
    expect(document.baseURI).toBe('https://evil.example/');
    createSafeMarkdownRenderer({ toHtml: passthrough, document })({ element: target,
      content: '<p><img src="/x.png"><img src="https://evil.example/y.png"></p>' });
    expect(sources(target)).toEqual([]);
  });

  it('resolves relative images against the base element and keeps them when that stays same-origin', () => {
    const { document, target } = page({ head: '<base href="https://site.example/assets/">' });
    createSafeMarkdownRenderer({ toHtml: passthrough, document })({ element: target, content: '<p><img src="x.png"></p>' });
    expect(sources(target)).toEqual(['x.png']);
  });

  it('an injected origin overrides the document location, and a document with no origin keeps no image', () => {
    const { document, target } = page();
    createSafeMarkdownRenderer({ toHtml: passthrough, document }, { origin: 'https://cdn.example' })({ element: target,
      content: '<p><img src="https://cdn.example/a.png"><img src="/b.png"></p>' });
    expect(sources(target)).toEqual(['https://cdn.example/a.png']);
    const blank = document.implementation.createHTMLDocument('');
    const holder = blank.createElement('div');
    createSafeMarkdownRenderer({ toHtml: passthrough, document: blank })({ element: holder, content: '<img src="https://site.example/a.png">' });
    expect(sources(holder)).toEqual([]);
  });

  it('links get noopener noreferrer', () => {
    const { document, target } = page();
    createSafeMarkdownRenderer({ toHtml: passthrough, document })({ element: target,
      content: '<p><a href="https://elsewhere.example/">out</a> <a href="/in">in</a> <a name="anchor">anchor</a></p>' });
    expect([...target.querySelectorAll('a')].map(link => link.getAttribute('rel'))).toEqual(['noopener noreferrer', 'noopener noreferrer', null]);
  });

  it('the fragment is filtered before insertion', () => {
    const { document, target } = page();
    const inserted: string[][] = [];
    const replaceChildren = target.replaceChildren.bind(target);
    target.replaceChildren = (...nodes: (Node | string)[]) => {
      // Inspect exactly what is about to enter the live document.
      inserted.push(nodes.flatMap(node => node instanceof document.defaultView!.DocumentFragment
        ? [...node.querySelectorAll('img')].map(image => image.getAttribute('src') ?? '') : []));
      replaceChildren(...nodes);
    };
    createSafeMarkdownRenderer({ toHtml: passthrough, document })({ element: target,
      content: '<p><img src="https://evil.example/x.png"><img src="/ok.png"></p>' });
    expect(inserted).toEqual([['/ok.png']]);
  });

  it('passes the message content to the injected converter and replaces earlier output', () => {
    const { document, target } = page();
    const seen: string[] = [];
    const render = createSafeMarkdownRenderer({ toHtml: ({ content }) => { seen.push(content); return `<p>${content.length}</p>`; }, document });
    render({ element: target, content: 'first' });
    render({ element: target, content: 'second!' });
    expect(seen).toEqual(['first', 'second!']);
    expect(target.innerHTML).toBe('<p>7</p>');
  });
});

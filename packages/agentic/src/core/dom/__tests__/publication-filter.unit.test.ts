import { afterEach, describe, expect, it } from 'vitest';
import type { PublishedPageElement } from '../../page-publication.js';
import { createPublicationFilter, publicElement, publishedText } from '../publication-filter.js';

/** @file Direct contract of the publication filter: which published element/action pairs it allows. */

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach(root => root.remove()));

function filterFor(markup: string, elements: readonly PublishedPageElement[]) {
  const root = document.createElement('main');
  root.innerHTML = markup;
  root.dataset.agentPublication = 'rev';
  document.body.append(root);
  roots.push(root);
  const filter = createPublicationFilter({ root, publication: { revision: 'rev', elements }, fieldOf: () => null });
  const at = (handle: string) => root.querySelector(`[data-agent-element="${handle}"]`)!;
  return { root, filter, at };
}

describe('createPublicationFilter', () => {
  it('allows fill only for an element published as fill, and selectOption only for one published as select', () => {
    const { filter, at } = filterFor('<input data-agent-element="name"><select data-agent-element="size"><option>S</option></select>',
      [{ handle: 'name', action: 'fill' }, { handle: 'size', action: 'select' }]);
    expect(filter.allows({ element: at('name'), action: 'fill' })).toBe(true);
    expect(filter.allows({ element: at('name'), action: 'selectOption' })).toBe(false);
    expect(filter.allows({ element: at('size'), action: 'selectOption' })).toBe(true);
    expect(filter.allows({ element: at('size'), action: 'fill' })).toBe(false);
  });

  it('refuses effects on a disabled or aria-disabled published control but still allows reading it', () => {
    const { filter, at } = filterFor('<input disabled data-agent-element="off"><button type="button" aria-disabled="true" data-agent-element="menu">M</button>',
      [{ handle: 'off', action: 'fill' }, { handle: 'menu', action: 'menu' }]);
    expect(filter.allows({ element: at('off'), action: 'fill' })).toBe(false);
    expect(filter.allows({ element: at('off'), action: 'read' })).toBe(true);
    expect(filter.allows({ element: at('menu'), action: 'click' })).toBe(false);
  });

  it('drops a handle the publication lists twice, and never allows an element with no handle', () => {
    const { root, filter, at } = filterFor('<section data-agent-element="panel">Text</section><p>untagged</p>',
      [{ handle: 'panel', action: 'read' }, { handle: 'panel', action: 'menu' }]);
    expect(filter.allows({ element: at('panel'), action: 'read' })).toBe(false);
    expect(filter.allows({ element: root.querySelector('p')!, action: 'read' })).toBe(false);
  });

  it('refuses to click a form submitter that was published as anything but submit', () => {
    const { filter, at } = filterFor('<form action="/contact"><button data-agent-element="send">Send</button></form>', [{ handle: 'send', action: 'menu' }]);
    expect(filter.allows({ element: at('send'), action: 'click' })).toBe(false);
  });

  it('refuses a published submit without a declared target or outside any form', () => {
    const { filter, at } = filterFor('<form action="/contact"><button data-agent-element="untargeted">Send</button></form><button type="button" data-agent-element="formless">Go</button>', [
      { handle: 'untargeted', action: 'submit' },
      { handle: 'formless', action: 'submit', target: { action: '/contact', method: 'get' } },
    ]);
    expect(filter.allows({ element: at('untargeted'), action: 'click' })).toBe(false);
    expect(filter.allows({ element: at('formless'), action: 'click' })).toBe(false);
  });

  it("matches a submitter with no form action against the page's own path, and refuses a method mismatch", () => {
    const path = document.location.pathname;
    const own = filterFor('<form><button data-agent-element="send">Send</button></form>', [{ handle: 'send', action: 'submit', target: { action: path, method: 'get' } }]);
    expect(own.filter.allows({ element: own.at('send'), action: 'click' })).toBe(true);
    const post = filterFor('<form><button data-agent-element="send">Send</button></form>', [{ handle: 'send', action: 'submit', target: { action: path, method: 'post' } }]);
    expect(post.filter.allows({ element: post.at('send'), action: 'click' })).toBe(false);
  });
});

describe('publishedText and publicElement', () => {
  it('reads public text nodes and skips comments', () => {
    const element = document.createElement('p');
    element.append('Visible', document.createComment('author note'), ' text');
    document.body.append(element);
    roots.push(element);
    expect(publishedText({ element })).toBe('Visible text');
  });

  it('treats an element of a window-less document as public when nothing marks it hidden', () => {
    const detached = document.implementation.createHTMLDocument('');
    const element = detached.createElement('p');
    detached.body.append(element);
    expect(detached.defaultView).toBeNull();
    expect(publicElement({ element })).toBe(true);
    element.setAttribute('hidden', '');
    expect(publicElement({ element })).toBe(false);
  });
});

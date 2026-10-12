import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import { MENU_DROPDOWN_SCRIPT, injectMenuDropdownScript, renderMenuToggle } from '../index.js';

// Untyped, as in listing/__tests__/see-more-script.test.ts: this package carries no @types/jsdom.
const { JSDOM } = createRequire(import.meta.url)('jsdom');

/** Runs the inline dropdown script in its own JSDOM window (no global DOM, per vitest.config.ts)
 *  over a two-item menu: a split "Blog" parent with a "Tips" flyout, and a link-less "Plan" parent. */
function page() {
  const dom = new JSDOM(
    `<ul class="menu-list depth-0" data-jini-dropdown>
      <li class="menu-item depth-0 has-children"><a href="/blog">Blog</a>${renderMenuToggle({ controlsId: 's1', label: 'Blog' })}
        <ul class="menu-list depth-1" id="s1">
          <li><a href="/blog/a">A</a></li>
          <li class="has-children">${renderMenuToggle({ controlsId: 's3', label: 'Tips' }, { asLabel: true })}<ul id="s3"><li><a href="/tips/1">T1</a></li></ul></li>
          <li><a href="/blog/c">C</a></li>
        </ul></li>
      <li class="menu-item depth-0 has-children">${renderMenuToggle({ controlsId: 's2', label: 'Plan' }, { asLabel: true })}
        <ul class="menu-list depth-1" id="s2"><li><a href="/plan/x">X</a></li></ul></li>
    </ul><button id="out" type="button">Out</button>`,
    { url: 'https://site.test/', runScripts: 'outside-only' }
  );
  const window = dom.window as unknown as Window & typeof globalThis & { eval(code: string): void };
  window.eval(MENU_DROPDOWN_SCRIPT);
  const doc = window.document;
  const $ = <T extends Element = HTMLElement>(sel: string) => doc.querySelector(sel) as unknown as T;
  const key = (el: Element, k: string) => {
    const ev = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const blog = $<HTMLButtonElement>('[aria-controls="s1"]');
  const plan = $<HTMLButtonElement>('[aria-controls="s2"]');
  const tips = $<HTMLButtonElement>('[aria-controls="s3"]');
  return { doc, $, key, blog, plan, tips };
}

const isOpen = (b: HTMLButtonElement) => b.getAttribute('aria-expanded') === 'true' && b.parentElement!.classList.contains('jini-menu-open');

test('renderMenuToggle: split toggle is empty with an aria-label; label form carries menu-item-label; both escape', () => {
  assert.equal(
    renderMenuToggle({ controlsId: 'jini-submenu-1', label: 'A "&" <b>' }),
    '<button type="button" class="jini-menu-toggle" aria-expanded="false" aria-controls="jini-submenu-1" aria-label="A &quot;&amp;&quot; &lt;b&gt; submenu"></button>'
  );
  assert.equal(
    renderMenuToggle({ controlsId: 'x"y', label: '<i>Plan</i>' }, { asLabel: true }),
    '<button type="button" class="menu-item-label jini-menu-toggle" aria-expanded="false" aria-controls="x&quot;y">&lt;i&gt;Plan&lt;/i&gt;</button>'
  );
});

test('injectMenuDropdownScript: once, only with a dropdown menu, before </body>', () => {
  const plain = '<html><body><ul class="menu-list"></ul></body></html>';
  assert.equal(injectMenuDropdownScript({ html: plain }), plain);
  const once = injectMenuDropdownScript({ html: '<html><body><ul data-jini-dropdown></ul></body></html>' });
  assert.ok(once.endsWith(`<script data-jini-menu-dropdown-script>${MENU_DROPDOWN_SCRIPT}</script></body></html>`));
  assert.equal(injectMenuDropdownScript({ html: once }), once);
  assert.equal(injectMenuDropdownScript({ html: '<ul data-jini-dropdown></ul>' }), `<ul data-jini-dropdown></ul><script data-jini-menu-dropdown-script>${MENU_DROPDOWN_SCRIPT}</script>`);
});

test('script: marks the root, click toggles aria-expanded + class, opening one closes its sibling, click outside closes', () => {
  const p = page();
  assert.ok(p.$('[data-jini-dropdown]').classList.contains('jini-menu-js'));
  p.blog.click();
  assert.ok(isOpen(p.blog));
  p.blog.click();
  assert.ok(!isOpen(p.blog));
  p.blog.click();
  p.plan.click();
  assert.ok(isOpen(p.plan));
  assert.ok(!isOpen(p.blog));
  p.$('#out').click();
  assert.ok(!isOpen(p.plan));
});

test('script: closing a parent closes its open flyout too', () => {
  const p = page();
  p.blog.click();
  p.tips.click();
  assert.ok(isOpen(p.blog) && isOpen(p.tips));
  p.blog.click();
  assert.ok(!isOpen(p.blog) && !isOpen(p.tips));
});

test('script: Escape closes the nearest open item and returns focus to its toggle', () => {
  const p = page();
  p.blog.click();
  p.tips.click();
  const t1 = p.$('a[href="/tips/1"]');
  t1.focus();
  p.key(t1, 'Escape');
  assert.ok(!isOpen(p.tips) && isOpen(p.blog));
  assert.equal(p.doc.activeElement, p.tips);
  p.key(p.tips, 'Escape');
  assert.ok(!isOpen(p.blog));
  assert.equal(p.doc.activeElement, p.blog);
});

test('script: ArrowDown on a toggle opens and focuses the first item; ArrowDown/Up move within the panel and clamp', () => {
  const p = page();
  p.blog.focus();
  assert.equal(p.key(p.blog, 'ArrowDown'), true);
  assert.ok(isOpen(p.blog));
  assert.equal(p.doc.activeElement, p.$('a[href="/blog/a"]'));
  p.key(p.doc.activeElement!, 'ArrowUp');
  assert.equal(p.doc.activeElement, p.$('a[href="/blog/a"]'));
  p.key(p.doc.activeElement!, 'ArrowDown');
  assert.equal(p.doc.activeElement, p.tips);
  p.key(p.doc.activeElement!, 'ArrowUp');
  assert.equal(p.doc.activeElement, p.$('a[href="/blog/a"]'));
  p.key(p.doc.activeElement!, 'ArrowDown');
  p.key(p.doc.activeElement!, 'ArrowDown'); // on the Tips toggle: opens the flyout
  assert.ok(isOpen(p.tips));
  assert.equal(p.doc.activeElement, p.$('a[href="/tips/1"]'));
});

test('script: ArrowLeft/Right move between top-level items; unhandled keys pass through', () => {
  const p = page();
  const blogLink = p.$('a[href="/blog"]');
  blogLink.focus();
  assert.equal(p.key(blogLink, 'ArrowRight'), true);
  assert.equal(p.doc.activeElement, p.plan);
  p.key(p.plan, 'ArrowRight');
  assert.equal(p.doc.activeElement, p.plan);
  p.key(p.plan, 'ArrowLeft');
  assert.equal(p.doc.activeElement, blogLink);
  assert.equal(p.key(blogLink, 'ArrowDown'), false);
  assert.equal(p.key(blogLink, 'a'), false);
});

test('script: focus moving outside an open item closes it', () => {
  const p = page();
  p.blog.click();
  p.plan.focus();
  assert.ok(!isOpen(p.blog));
  p.plan.click();
  p.$('#out').focus();
  assert.ok(!isOpen(p.plan));
});

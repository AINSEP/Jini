import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { CHAT_BUBBLE_STYLE } from '../chat-bubble-style.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');

it.each([
  ['.jini-chat-vanilla', 'font:14px/1.5 var(--jini-chat-font-body,system-ui,sans-serif);'],
  ['.jini-chat-vanilla', 'color:var(--jini-chat-text,CanvasText)'],
  ['.jini-chat-vanilla__panel', 'background:var(--jini-chat-background,Canvas);'],
  ['.jini-chat-vanilla__message a', 'color:var(--jini-chat-accent,#2563eb);'],
])('themes %s with an owned input and a terminal default: %s', (selector, declaration) => {
  const css = readFileSync(new URL('../../embed-widget/vanilla/style.css', import.meta.url), 'utf8');
  const rule = css.split(`${selector}{`)[1]!.split('}')[0];
  expect(rule).toContain(declaration);
});

it('gives the lazy bubble the same owned accent and blue default as the mounted widget', () => {
  const rule = CHAT_BUBBLE_STYLE.split('.jini-chat-bubble{')[1]!.split('}')[0];
  expect(rule).toContain('background:var(--jini-chat-accent,#2563eb);');
});

it('lets consent hide both the lazy bubble and the mounted vanilla shell, preserving default layouts', () => {
  const dom = new JSDOM(`<style>${CHAT_BUBBLE_STYLE}</style><div class="jini-chat-vanilla"><button class="jini-chat-bubble"></button><div role="dialog"></div></div>`);
  try {
    const rules = Array.from(dom.window.document.querySelector('style').sheet.cssRules) as CSSStyleRule[];
    expect(rules.find(rule => rule.selectorText === '.jini-chat-bubble')?.style.getPropertyValue('display')).toBe('var(--jini-floating-ui-display,grid)');
    expect(rules.find(rule => rule.selectorText === '.jini-chat-vanilla')?.style.getPropertyValue('display')).toBe('var(--jini-floating-ui-display,block)');
    expect(rules.find(rule => rule.selectorText === '.jini-chat-bubble[hidden]')?.style.getPropertyValue('display')).toBe('none');
    expect(rules.find(rule => rule.selectorText === '.jini-chat-bubble[hidden]')?.style.getPropertyPriority('display')).toBe('important');
  } finally { dom.window.close(); }
});

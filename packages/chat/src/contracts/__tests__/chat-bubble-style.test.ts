import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { CHAT_BUBBLE_STYLE } from '../chat-bubble-style.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');

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

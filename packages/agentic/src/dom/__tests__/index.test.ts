import { describe, expect, it } from 'vitest';

import * as domBarrel from '../index.js';

/**
 * `./dom` is a separately-compiled public entry point (its own `tsconfig.dom.json`), so what a
 * consumer can reach is exactly what this barrel re-exports — nothing else in `src/dom/` is
 * importable. Driving the two exported functions *through the barrel* is what proves the entry
 * point is wired, which importing the sub-modules directly (as every other test in this directory
 * does) cannot.
 */
describe('@jini-ai/agentic/dom public barrel', () => {
  it('re-exports a working createDomPageDriver, resolving a published handle end to end', async () => {
    const root = document.createElement('main');
    root.innerHTML = '<section data-agent-page="lab"><button data-agent-element="save" data-agent-role="button" data-agent-label="Save">Save</button></section>';
    document.body.append(root);

    const driver = domBarrel.createDomPageDriver({ root, pages: {} });
    expect((await driver.findElements({})).map((element) => element.handle)).toEqual(['save']);

    root.remove();
  });

  it('re-exports currentAgentPage, reading the enclosing data-agent-page', () => {
    const root = document.createElement('main');
    root.innerHTML = '<section data-agent-page="lab"><span data-agent-element="s" data-agent-role="status">x</span></section>';
    document.body.append(root);

    expect(domBarrel.currentAgentPage(root)).toBe('lab');

    root.remove();
  });

  it('re-exports getAgentModelContext, which reports no WebMCP surface on a bare jsdom page', () => {
    expect(domBarrel.getAgentModelContext()).toBeUndefined();
  });
});

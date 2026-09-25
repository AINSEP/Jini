import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AGENT_PRIVATE_ATTRIBUTE } from '../../element-handles.js';
import { createDomPageDriver } from '../dom-page-driver.js';

/**
 * A `[data-agent-private]` subtree is invisible to the page driver: no text, value or element
 * inside it reaches an agent through any read path, including the `text` a published ANCESTOR
 * reports. The motivating case is a revealed secret (the Site Token / root key) rendered inside
 * a published card: before this, reading the card's state returned its whole `textContent`,
 * secret included.
 */

const SECRET = 'a3f9c0de5b7e41aa9d02c6b8e17f3d4c5a6b7c8d9e0f11223344556677889900';

const MARKUP = `
  <section data-agent-element="token-card" data-agent-role="region" data-agent-label="The token card">
    <p>Fingerprint: abc123</p>
    <div data-agent-private>
      <code>${SECRET}</code>
      <button data-agent-element="inside-private" data-agent-role="button" data-agent-label="Inside">Copy</button>
    </div>
  </section>
  <section data-agent-element="unlabelled-card" data-agent-role="region">
    Visible words
    <span data-agent-private>${SECRET}</span>
  </section>
  <div data-agent-element="wrapper-with-private-input" data-agent-role="field" data-agent-label="Wrapper">
    <span data-agent-private><input name="plain" type="text" value="${SECRET}" /></span>
  </div>
  <code data-agent-element="self-private" data-agent-role="field" data-agent-label="Self" data-agent-private>${SECRET}</code>
`;

let root: HTMLElement;

function makeDriver() {
  return createDomPageDriver({ root, pages: {} });
}

beforeEach(() => {
  root = document.createElement('main');
  root.innerHTML = MARKUP;
  document.body.append(root);
});

afterEach(() => {
  root.remove();
});

describe('data-agent-private', () => {
  it('names the attribute data-agent-private', () => {
    expect(AGENT_PRIVATE_ATTRIBUTE).toBe('data-agent-private');
  });

  it('leaves a private subtree out of a published ancestor\'s state text', async () => {
    const state = await makeDriver().describeState?.('token-card');
    expect(state?.text).toContain('Fingerprint: abc123');
    expect(state?.text).not.toContain(SECRET);
  });

  it('leaves a private subtree out of the text-content label fallback', async () => {
    const found = await makeDriver().findElements({});
    const card = found.find((element) => element.handle === 'unlabelled-card');
    expect(card?.label).toContain('Visible words');
    expect(card?.label).not.toContain(SECRET);
  });

  it('cannot be found by querying for the private text', async () => {
    expect(await makeDriver().findElements({ query: SECRET.slice(0, 16) })).toEqual([]);
  });

  it('does not publish an element tagged inside a private subtree, or one that is itself private', async () => {
    const handles = (await makeDriver().findElements({})).map((element) => element.handle);
    expect(handles).not.toContain('inside-private');
    expect(handles).not.toContain('self-private');
    expect(await makeDriver().describeState?.('inside-private')).toBeNull();
    expect(await makeDriver().describeState?.('self-private')).toBeNull();
    await expect(makeDriver().click('inside-private')).rejects.toThrow('no element published as "inside-private" on this page');
  });

  it('never adopts a control inside a private subtree as a wrapper\'s control', async () => {
    const state = await makeDriver().describeState?.('wrapper-with-private-input');
    expect(state).not.toHaveProperty('value');
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });
});

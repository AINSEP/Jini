// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '../dom-page-driver.js';
import { createConsoleLogger } from '@jini-ai/core/primitives';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('reports a duplicate handle with fixed copy and preserves the ambiguity refusal', async () => {
  const sentinel = 'amber-gull-private-meadow';
  const root = document.createElement('div');
  root.innerHTML = `<button data-agent-element="${sentinel}">A</button><button data-agent-element="${sentinel}">B</button>`;
  document.body.append(root);
  const output = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const report = createConsoleLogger({ prefix: 'dom' });
  const driver = createDomPageDriver({ root, pages: {} }, { report });
  await expect(driver.click({ handle: sentinel })).rejects.toThrow('published on 2 elements');
  expect(output).toHaveBeenCalledTimes(1);
  expect(output.mock.calls).toEqual([['dom A data-agent-element handle is published on 2 elements on this page (duplicate handle).']]);
  expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
});

it.each([Object.assign(new Error('indigo-heron-private-garden'), { stack: 'indigo-heron-private-garden' }), 'indigo-heron-private-garden'])('preserves the duplicate-handle refusal when its reporter throws', async error => {
  const root = document.createElement('div');
  root.innerHTML = '<button data-agent-element="duplicate">A</button><button data-agent-element="duplicate">B</button>';
  document.body.append(root);
  const warn = vi.fn(() => { throw error; });
  const driver = createDomPageDriver({ root, pages: {} }, { report: { warn } });
  await expect(driver.click({ handle: 'duplicate' })).rejects.toThrow('published on 2 elements');
  expect(warn).toHaveBeenCalledTimes(1);
});

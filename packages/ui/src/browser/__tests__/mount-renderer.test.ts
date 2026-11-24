/**
 * @file Coverage for `mount-renderer.ts`: the app is rendered into the element the page ships
 * (default id `root`, or a caller-chosen id), and a missing host element is an error naming that
 * element, with no root created. Small fakes for `document` and `createRoot`; no module mocks.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';

import { mountRenderer, type RendererRoot } from '../mount-renderer.js';

interface FakeHost {
  document: { getElementById(id: string): Element | null };
  lookups: string[];
  created: Element[];
  rendered: unknown[];
  createRoot: (container: Element) => RendererRoot;
}

function fakeHost(elements: Record<string, Element>): FakeHost {
  const host: FakeHost = {
    lookups: [],
    created: [],
    rendered: [],
    document: {
      getElementById(id) {
        host.lookups.push(id);
        return elements[id] ?? null;
      },
    },
    createRoot(container) {
      host.created.push(container);
      return { render: (children) => void host.rendered.push(children) };
    },
  };
  return host;
}

const rootElement = { id: 'root' } as unknown as Element;
const otherElement = { id: 'shell' } as unknown as Element;
const app = { type: 'App' };

test('renders the app into #root by default and returns the root it created', () => {
  const host = fakeHost({ root: rootElement, shell: otherElement });
  const root = mountRenderer({ document: host.document, createRoot: host.createRoot, app: app as never });
  assert.deepEqual(host.lookups, ['root']);
  assert.equal(host.created.length, 1);
  assert.equal(host.created[0], rootElement);
  assert.deepEqual(host.rendered, [app]);
  assert.equal(typeof root.render, 'function');
});

test('a caller-chosen rootId selects that element instead', () => {
  const host = fakeHost({ root: rootElement, shell: otherElement });
  mountRenderer({ document: host.document, createRoot: host.createRoot, app: app as never }, { rootId: 'shell' });
  assert.deepEqual(host.lookups, ['shell']);
  assert.equal(host.created[0], otherElement);
  assert.deepEqual(host.rendered, [app]);
});

test('a missing host element throws an error naming it, and no root is created', () => {
  const host = fakeHost({});
  assert.throws(
    () => mountRenderer({ document: host.document, createRoot: host.createRoot, app: app as never }),
    { message: 'renderer: #root missing from index.html' },
  );
  assert.throws(
    () => mountRenderer({ document: host.document, createRoot: host.createRoot, app: app as never }, { rootId: 'shell' }),
    { message: 'renderer: #shell missing from index.html' },
  );
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.rendered, []);
});

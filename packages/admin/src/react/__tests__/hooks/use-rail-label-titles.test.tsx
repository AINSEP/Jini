import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useRailLabelTitles } from '../../hooks/use-rail-label-titles.js';

function mountNav() {
  const nav = document.createElement('nav');
  nav.id = 'fixture-nav';
  nav.innerHTML = '<a class="row" title="Rail: Records"><b>Records</b></a>'
    + '<a class="row"><b>Pages</b></a>'
    + '<a class="row" href="/special" title="Other owner"><b>Special</b></a>'
    + '<a class="row" title="kept"><b></b></a>'
    + '<a class="other" title="untouched"><b>Other</b></a>';
  document.body.append(nav);
  return nav;
}
const titles = (nav: HTMLElement) => [...nav.querySelectorAll('a')].map(link => link.getAttribute('title'));
const required = {
  navId: 'fixture-nav', linkSelector: 'a.row', labelSelector: 'b',
  skipLink: ({ link }: { link: Element }) => link.getAttribute('href') === '/special',
};

afterEach(() => { document.body.innerHTML = ''; });

it('titles matching visible labels, removes skipped titles, and leaves empty or unrelated labels alone', () => {
  const nav = mountNav();
  const hook = renderHook(() => useRailLabelTitles(required, { doc: document }));
  expect(titles(nav)).toEqual(['Records', 'Pages', null, 'kept', 'untouched']);
  hook.unmount();
  expect(titles(nav)).toEqual(['Rail: Records', null, null, 'kept', 'untouched']);
});

it('observes changed labels and replaced rows, then disconnects and restores original titles', async () => {
  const nav = mountNav();
  const original = nav.querySelector('a')!;
  const hook = renderHook(() => useRailLabelTitles(required, { doc: document }));
  await act(async () => { original.querySelector('b')!.textContent = 'Translated'; });
  expect(original.getAttribute('title')).toBe('Translated');
  await act(async () => {
    nav.innerHTML = '<a class="row" title="Rail: New"><b>New</b></a><a class="row"><b>Media</b></a>';
  });
  expect(titles(nav)).toEqual(['New', 'Media']);
  hook.unmount();
  expect(original.getAttribute('title')).toBe('Rail: Records');
  expect(titles(nav)).toEqual(['Rail: New', null]);
  await act(async () => { nav.querySelector('b')!.textContent = 'After unmount'; });
  expect(titles(nav)).toEqual(['Rail: New', null]);
});

it('uses the supplied document and treats a missing nav as a no-op', () => {
  const nav = mountNav();
  renderHook(() => useRailLabelTitles({ ...required, navId: 'missing' }, { doc: document }));
  expect(titles(nav)).toEqual(['Rail: Records', null, 'Other owner', 'kept', 'untouched']);
  const doc = document.implementation.createHTMLDocument();
  const otherNav = doc.createElement('nav');
  otherNav.id = required.navId;
  otherNav.innerHTML = '<a class="row"><b>Injected</b></a>';
  doc.body.append(otherNav);
  const hook = renderHook(() => useRailLabelTitles({ navId: required.navId, linkSelector: 'a.row', labelSelector: 'b' }, { doc }));
  expect(otherNav.querySelector('a')!.title).toBe('Injected');
  expect(titles(nav)[0]).toBe('Rail: Records');
  hook.unmount();
});

import { readFileSync } from 'node:fs';
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps } from '../types.js';
import { authenticated, baseFields, labels, panels, ports, renderWithKit as render } from './shell-fixture.js';

// The shell's layout markup is shared by two kinds of stylesheet. Jini's own packaged CSS styles the
// `jini-admin-layout` / `jini-admin-content` classes (and still styles the legacy names, because a host
// that renders its own legacy-class chrome relies on those rules). A consuming admin host additionally styles
// the legacy `admin-main-col`, `skip-link` and `sidebar-backdrop` names, for which Jini ships no rule. The
// real packaged sheets are injected here, plus a host sheet for the host-only names, so renaming a class in
// markup without its selector (or dropping an alias) turns a pin red.
const readSheet = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const layoutSheet = readSheet('../../../../../ui/src/styles/admin.css');
// jsdom does not evaluate media queries, so the phone-width rule is injected unwrapped: the pin is on its selector.
const contentSheet = (/@media \(max-width: 640px\) \{\n([\s\S]*?\n)\}\n/.exec(readSheet('../../../screens/dashboard/dashboard.css'))?.[1]) ?? '';
const jiniHostCss = `
  .jini-admin-main-col { position: relative; }
  .jini-admin-skip-link { top: 7px; }
  .jini-admin-sidebar-backdrop { z-index: 45; }
`;
const legacyHostCss = `
  .admin-main-col { min-width: 0; }
  .skip-link { left: 9px; }
  .sidebar-backdrop { position: fixed; }
`;

const injectCss = (css: string): void => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
};

beforeEach(() => {
  localStorage.clear();
  [layoutSheet, contentSheet, jiniHostCss, legacyHostCss].forEach(injectCss);
});
afterEach(() => { cleanup(); document.body.querySelectorAll('[data-pin-clone]').forEach((node) => node.remove()); document.head.querySelectorAll('style').forEach((node) => node.remove()); });

function shellProps(): AdminShellHostProps {
  const toolbarPanels = panels.map((panel, index) => (index === 0
    ? { ...panel, render: () => <div className="page-toolbar"><a href="#docs">Docs</a><a href="#cta" className="btn">Go</a></div> }
    : panel));
  return { ...baseFields(ports('/')), panels: toolbarPanels, useHostSession: authenticated() };
}

/** Both class names style an element: strip one and the other still resolves the same rule. */
function withOnlyClass(element: HTMLElement, keep: string, drop: string): HTMLElement {
  const clone = element.cloneNode(false) as HTMLElement;
  clone.classList.remove(drop);
  expect(clone).toHaveClass(keep);
  clone.dataset.pinClone = '';
  document.body.append(clone);
  return clone;
}

describe('AdminShell layout root', () => {
  it('styles the root through the prefixed class and still through the legacy alias', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const layout = getByRole('link', { name: labels.skipToContent }).parentElement as HTMLElement;
    expect(layout).toHaveClass('jini-admin-layout', 'admin-layout');
    expect(getComputedStyle(layout).getPropertyValue('background')).toBe('var(--jini-bg)');
    expect(getComputedStyle(withOnlyClass(layout, 'jini-admin-layout', 'admin-layout')).getPropertyValue('background')).toBe('var(--jini-bg)');
    expect(getComputedStyle(withOnlyClass(layout, 'admin-layout', 'jini-admin-layout')).getPropertyValue('background')).toBe('var(--jini-bg)');
  });

  it('keeps the host className after both layout classes and scopes the heading font to the root', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} className="hides-fab-while-open" />);
    const layout = getByRole('link', { name: labels.skipToContent }).parentElement as HTMLElement;
    const heading = document.createElement('h1');
    getByRole('main').append(heading);
    expect(layout.className).toBe('jini-admin-layout admin-layout hides-fab-while-open');
    expect(getComputedStyle(heading).fontFamily).toBe('var(--jini-font-heading)');
  });
});

describe('AdminShell content region', () => {
  it('styles the main landmark through the prefixed class and the legacy alias', () => {
    const { getByRole, getByText } = render(<AdminShell {...shellProps()} />);
    const main = getByRole('main');
    expect(main).toHaveClass('jini-admin-content', 'admin-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    const link = getByText('Docs');
    expect(getComputedStyle(link).display).toBe('inline-block');
    expect(getComputedStyle(getByText('Go')).display).not.toBe('inline-block');
    for (const [keep, drop] of [['jini-admin-content', 'admin-content'], ['admin-content', 'jini-admin-content']] as const) {
      const bare = withOnlyClass(main, keep, drop);
      const toolbar = document.createElement('div');
      toolbar.className = 'page-toolbar';
      toolbar.innerHTML = '<a href="#d">Docs only</a>';
      bare.append(toolbar);
      expect(getComputedStyle(toolbar.querySelector('a') as HTMLElement).display, keep).toBe('inline-block');
    }
  });
});

describe('AdminShell main column, skip link and backdrop', () => {
  it('styles the main column through both names', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const column = getByRole('main').parentElement as HTMLElement;
    expect(column).toHaveClass('jini-admin-main-col', 'admin-main-col');
    expect(getComputedStyle(column).position).toBe('relative');
    expect(getComputedStyle(column).minWidth).toBe('0');
  });

  it('styles the skip link through both names and keeps it a link to the main landmark', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const skip = getByRole('link', { name: labels.skipToContent });
    expect(skip).toHaveClass('jini-admin-skip-link', 'skip-link');
    expect(skip).toHaveAttribute('href', `#${getByRole('main').id}`);
    expect(getComputedStyle(skip).top).toBe('7px');
    expect(getComputedStyle(skip).left).toBe('9px');
  });

  it('styles the drawer backdrop through both names and closes the drawer on click', () => {
    const { getByRole, getAllByRole, queryAllByRole } = render(<AdminShell {...shellProps()} />);
    expect(queryAllByRole('button', { name: labels.closeNavigation })).toHaveLength(0);
    fireEvent.click(getByRole('button', { name: labels.openNavigation }));
    const backdrop = getAllByRole('button', { name: labels.closeNavigation }).find((button) => !button.hasAttribute('aria-expanded')) as HTMLElement;
    expect(backdrop).toHaveClass('jini-admin-sidebar-backdrop', 'sidebar-backdrop');
    expect(getComputedStyle(backdrop).zIndex).toBe('45');
    expect(getComputedStyle(backdrop).position).toBe('fixed');
    fireEvent.click(backdrop);
    expect(queryAllByRole('button', { name: labels.closeNavigation })).toHaveLength(0);
  });
});

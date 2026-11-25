import { readFileSync } from 'node:fs';
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps } from '../types.js';
import { authenticated, baseFields, labels, panels, ports, renderWithKit as render } from './shell-fixture.js';

// Jini's own packaged CSS styles the `jini-admin-layout` / `jini-admin-content` classes, and hosts style
// `jini-admin-main-col`, `jini-admin-skip-link` and `jini-admin-sidebar-backdrop`; the unprefixed aliases are
// gone. The real packaged sheets are injected, plus a host sheet written against the dropped unprefixed names
// that must NOT resolve, so renaming a class in markup without its selector, or an alias coming back, turns a pin red.
const readSheet = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const layoutSheet = readSheet('../../../../../ui/src/styles/admin.css');
// jsdom does not evaluate media queries, so the phone-width rule is injected unwrapped: the pin is on its selector.
const contentSheet = (/@media \(max-width: 640px\) \{\n([\s\S]*?\n)\}\n/.exec(readSheet('../../../screens/dashboard/dashboard.css'))?.[1]) ?? '';
const jiniHostCss = `
  .jini-admin-main-col { position: relative; }
  .jini-admin-skip-link { top: 7px; }
  .jini-admin-sidebar-backdrop { z-index: 45; }
`;
const droppedAliasCss = `
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
  [layoutSheet, contentSheet, jiniHostCss, droppedAliasCss].forEach(injectCss);
});
afterEach(() => { cleanup(); document.body.querySelectorAll('[data-pin-clone]').forEach((node) => node.remove()); document.head.querySelectorAll('style').forEach((node) => node.remove()); });

function shellProps(): AdminShellHostProps {
  const toolbarPanels = panels.map((panel, index) => (index === 0
    ? { ...panel, render: () => <div className="page-toolbar"><a href="#docs">Docs</a><a href="#cta" className="btn">Go</a></div> }
    : panel));
  return { ...baseFields(ports('/')), panels: toolbarPanels, useHostSession: authenticated() };
}

/** A detached copy of the element carrying exactly `className`, to ask which name a packaged rule selects. */
function withOnlyClass(element: HTMLElement, className: string): HTMLElement {
  const clone = element.cloneNode(false) as HTMLElement;
  clone.className = className;
  clone.dataset.pinClone = '';
  document.body.append(clone);
  return clone;
}

describe('AdminShell layout root', () => {
  it('styles the root through the prefixed class only', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const layout = getByRole('link', { name: labels.skipToContent }).parentElement as HTMLElement;
    expect(layout).toHaveClass('jini-admin-layout');
    expect(layout).not.toHaveClass('admin-layout');
    expect(getComputedStyle(layout).getPropertyValue('background')).toBe('var(--jini-bg)');
    expect(getComputedStyle(withOnlyClass(layout, 'admin-layout')).getPropertyValue('background')).not.toBe('var(--jini-bg)');
  });

  it('keeps the host className after the layout class and scopes the heading font to the root', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} className="hides-fab-while-open" />);
    const layout = getByRole('link', { name: labels.skipToContent }).parentElement as HTMLElement;
    const heading = document.createElement('h1');
    getByRole('main').append(heading);
    expect(layout.className).toBe('jini-admin-layout hides-fab-while-open');
    expect(getComputedStyle(heading).fontFamily).toBe('var(--jini-font-heading)');
  });
});

describe('AdminShell content region', () => {
  it('styles the main landmark through the prefixed class only', () => {
    const { getByRole, getByText } = render(<AdminShell {...shellProps()} />);
    const main = getByRole('main');
    expect(main).toHaveClass('jini-admin-content');
    expect(main).not.toHaveClass('admin-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    const link = getByText('Docs');
    expect(getComputedStyle(link).display).toBe('inline-block');
    expect(getComputedStyle(getByText('Go')).display).not.toBe('inline-block');
    for (const [only, display] of [['jini-admin-content', 'inline-block'], ['admin-content', '']] as const) {
      const bare = withOnlyClass(main, only);
      const toolbar = document.createElement('div');
      toolbar.className = 'page-toolbar';
      toolbar.innerHTML = '<a href="#d">Docs only</a>';
      bare.append(toolbar);
      expect(getComputedStyle(toolbar.querySelector('a') as HTMLElement).display === 'inline-block' ? 'inline-block' : '', only).toBe(display);
    }
  });
});

describe('AdminShell main column, skip link and backdrop', () => {
  it('styles the main column through the prefixed name only', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const column = getByRole('main').parentElement as HTMLElement;
    expect(column).toHaveClass('jini-admin-main-col');
    expect(column).not.toHaveClass('admin-main-col');
    expect(getComputedStyle(column).position).toBe('relative');
    expect(getComputedStyle(column).minWidth).not.toBe('0');
  });

  it('styles the skip link through the prefixed name only and keeps it a link to the main landmark', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const skip = getByRole('link', { name: labels.skipToContent });
    expect(skip).toHaveClass('jini-admin-skip-link');
    expect(skip).not.toHaveClass('skip-link');
    expect(skip).toHaveAttribute('href', `#${getByRole('main').id}`);
    expect(getComputedStyle(skip).top).toBe('7px');
    expect(getComputedStyle(skip).left).not.toBe('9px');
  });

  it('styles the drawer backdrop through the prefixed name only and closes the drawer on click', () => {
    const { getByRole, getAllByRole, queryAllByRole } = render(<AdminShell {...shellProps()} />);
    expect(queryAllByRole('button', { name: labels.closeNavigation })).toHaveLength(0);
    fireEvent.click(getByRole('button', { name: labels.openNavigation }));
    const backdrop = getAllByRole('button', { name: labels.closeNavigation }).find((button) => !button.hasAttribute('aria-expanded')) as HTMLElement;
    expect(backdrop).toHaveClass('jini-admin-sidebar-backdrop');
    expect(backdrop).not.toHaveClass('sidebar-backdrop');
    expect(getComputedStyle(backdrop).zIndex).toBe('45');
    expect(getComputedStyle(backdrop).position).not.toBe('fixed');
    fireEvent.click(backdrop);
    expect(queryAllByRole('button', { name: labels.closeNavigation })).toHaveLength(0);
  });
});

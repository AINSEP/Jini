import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps } from '../types.js';
import { authenticated, baseFields, controller, ports, renderWithKit as render } from './shell-fixture.js';

// Hosts style the shell chrome through the prefixed `jini-admin-*` classes only. A stylesheet written
// against the dropped unprefixed names (`.boot-screen`, `.admin-topbar*`) is injected too and must NOT
// resolve, so renaming a class in markup without its selector, or putting an unprefixed alias back, turns a pin red.
const jiniHostCss = `
  .jini-admin-boot-screen { display: grid; place-items: center; }
  .jini-admin-topbar { display: flex; gap: 8px; }
  .jini-admin-topbar-toggle[aria-expanded="true"] { opacity: 0.5; }
  .jini-admin-topbar-title { font-weight: 700; }
`;
const droppedAliasCss = `
  .boot-screen { height: 100vh; }
  .admin-topbar { padding: 4px; }
  .admin-topbar-toggle { cursor: pointer; }
  .admin-topbar-toggle[aria-expanded="true"] { border-top-width: 3px; }
  .admin-topbar-title { font-size: 20px; }
`;

const injectHostCss = (css: string): void => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
};

beforeEach(() => { localStorage.clear(); injectHostCss(jiniHostCss); injectHostCss(droppedAliasCss); });
afterEach(() => { cleanup(); document.head.querySelectorAll('style').forEach((node) => node.remove()); });

function shellProps(): AdminShellHostProps {
  const fields = baseFields(ports('/'));
  return { ...fields, useHostSession: authenticated() };
}

describe('AdminShell boot screen', () => {
  it('carries only the prefixed class and resolves the prefixed host stylesheet', () => {
    const fields = baseFields(ports('/'));
    const { getByRole } = render(<AdminShell {...fields} useHostSession={() => controller({ status: 'checking' })} />);
    const boot = getByRole('status');
    expect(boot).toHaveTextContent('Checking session');
    expect(boot).toHaveClass('jini-admin-boot-screen');
    expect(boot).not.toHaveClass('boot-screen');
    expect(getComputedStyle(boot).display).toBe('grid');
    expect(getComputedStyle(boot).height).not.toBe('100vh');
  });
});

describe('AdminShell topbar', () => {
  it('styles the topbar through the prefixed classes and never through the dropped unprefixed names', () => {
    const { getByRole, container } = render(<AdminShell {...shellProps()} />);
    const topbar = getByRole('button', { name: 'Open navigation' }).parentElement as HTMLElement;
    expect(topbar).toHaveClass('jini-admin-topbar');
    expect(topbar).not.toHaveClass('admin-topbar');
    expect(getComputedStyle(topbar).display).toBe('flex');
    expect(getComputedStyle(topbar).gap).toBe('8px');
    expect(getComputedStyle(topbar).padding).not.toBe('4px');
    const title = container.querySelector('.jini-admin-topbar-title') as HTMLElement;
    expect(title).not.toHaveClass('admin-topbar-title');
    expect(getComputedStyle(title).fontWeight).toBe('700');
    expect(getComputedStyle(title).fontSize).not.toBe('20px');
  });

  it('keeps the toggle accessible and its aria-expanded state selectors working on the prefixed class', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const toggle = getByRole('button', { name: 'Open navigation' });
    expect(toggle).toHaveClass('jini-admin-topbar-toggle');
    expect(toggle).not.toHaveClass('admin-topbar-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(getComputedStyle(toggle).cursor).not.toBe('pointer');
    expect(getComputedStyle(toggle).opacity).not.toBe('0.5');
    fireEvent.click(toggle);
    const open = getByRole('button', { name: 'Close navigation', expanded: true });
    expect(open).toHaveClass('jini-admin-topbar-toggle');
    expect(open).not.toHaveClass('admin-topbar-toggle');
    expect(getComputedStyle(open).opacity).toBe('0.5');
    expect(getComputedStyle(open).borderTopWidth).not.toBe('3px');
  });
});

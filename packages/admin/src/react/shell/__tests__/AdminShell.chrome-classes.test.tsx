import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps } from '../types.js';
import { authenticated, baseFields, controller, ports, renderWithKit as render } from './shell-fixture.js';

// Two hosts share the shell chrome markup. A Jini-aware host styles the `jini-admin-*` classes; the
// consuming admin host (its `.boot-screen` and `.admin-topbar*` selectors) still
// styles the legacy names. Both stylesheets are injected here, each from the host's own selectors,
// so renaming a class in markup without its selector (or dropping the alias) turns a pin red.
const jiniHostCss = `
  .jini-admin-boot-screen { display: grid; place-items: center; }
  .jini-admin-topbar { display: flex; gap: 8px; }
  .jini-admin-topbar-toggle[aria-expanded="true"] { opacity: 0.5; }
  .jini-admin-topbar-title { font-weight: 700; }
`;
const legacyHostCss = `
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

beforeEach(() => { localStorage.clear(); injectHostCss(jiniHostCss); injectHostCss(legacyHostCss); });
afterEach(() => { cleanup(); document.head.querySelectorAll('style').forEach((node) => node.remove()); });

function shellProps(): AdminShellHostProps {
  const fields = baseFields(ports('/'));
  return { ...fields, useHostSession: authenticated() };
}

describe('AdminShell boot screen', () => {
  it('carries the prefixed class plus the host-contract alias and resolves both host stylesheets', () => {
    const fields = baseFields(ports('/'));
    const { getByRole } = render(<AdminShell {...fields} useHostSession={() => controller({ status: 'checking' })} />);
    const boot = getByRole('status');
    expect(boot).toHaveTextContent('Checking session');
    expect(boot).toHaveClass('jini-admin-boot-screen', 'boot-screen');
    expect(getComputedStyle(boot).display).toBe('grid');
    expect(getComputedStyle(boot).height).toBe('100vh');
  });
});

describe('AdminShell topbar', () => {
  it('styles the topbar through both the prefixed class and the legacy host alias', () => {
    const { getByRole, container } = render(<AdminShell {...shellProps()} />);
    const topbar = getByRole('button', { name: 'Open navigation' }).parentElement as HTMLElement;
    expect(topbar).toHaveClass('jini-admin-topbar', 'admin-topbar');
    expect(getComputedStyle(topbar).display).toBe('flex');
    expect(getComputedStyle(topbar).gap).toBe('8px');
    expect(getComputedStyle(topbar).padding).toBe('4px');
    const title = container.querySelector('.admin-topbar-title') as HTMLElement;
    expect(title).toHaveClass('jini-admin-topbar-title', 'admin-topbar-title');
    expect(getComputedStyle(title).fontWeight).toBe('700');
    expect(getComputedStyle(title).fontSize).toBe('20px');
  });

  it('keeps the toggle accessible and its aria-expanded state selectors working on both class names', () => {
    const { getByRole } = render(<AdminShell {...shellProps()} />);
    const toggle = getByRole('button', { name: 'Open navigation' });
    expect(toggle).toHaveClass('jini-admin-topbar-toggle', 'admin-topbar-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(getComputedStyle(toggle).cursor).toBe('pointer');
    expect(getComputedStyle(toggle).opacity).not.toBe('0.5');
    fireEvent.click(toggle);
    const open = getByRole('button', { name: 'Close navigation', expanded: true });
    expect(open).toHaveClass('jini-admin-topbar-toggle', 'admin-topbar-toggle');
    expect(getComputedStyle(open).opacity).toBe('0.5');
    expect(getComputedStyle(open).borderTopWidth).toBe('3px');
  });
});

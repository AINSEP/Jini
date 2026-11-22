import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps, AdminShellProps } from '../types.js';
import { authenticated, baseFields, ports, renderWithKit as render } from './shell-fixture.js';

// J2 step 2: the nav is derived once per (panels, capabilities, permissions, translateNav, route), not once per render.
afterEach(cleanup);

type Translate = NonNullable<AdminShellProps['translateNav']>;
const counting = () => vi.fn<Translate>(({ groups }) => groups.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, label: `L ${item.label}` })) })));

function mount(translateNav: Translate, path = '/') {
  const p = ports(path);
  const props: AdminShellHostProps = { ...baseFields(p), useHostSession: authenticated(), translateNav };
  const view = render(<AdminShell {...props} />);
  return { p, props, ...view };
}

it('re-rendering with identical props does not rebuild the nav', () => {
  const translateNav = counting();
  const { props, rerender } = mount(translateNav);
  expect(screen.getByRole('link', { name: 'L Overview' })).toBeInTheDocument();
  const first = translateNav.mock.calls.length;
  expect(first).toBe(1);
  rerender(<AdminShell {...props} />);
  rerender(<AdminShell {...props} />);
  expect(translateNav).toHaveBeenCalledTimes(first);
});

it('opening the drawer (a state change inside the shell) does not rebuild the nav', () => {
  const translateNav = counting();
  mount(translateNav);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close navigation', expanded: true }));
  expect(translateNav).toHaveBeenCalledTimes(1);
});

it('a route change rebuilds it once, and a new translateNav identity rebuilds it once', () => {
  const translateNav = counting();
  const { p, props, rerender } = mount(translateNav);
  act(() => p.go('/records/r1'));
  expect(translateNav).toHaveBeenCalledTimes(2);
  const next = counting();
  rerender(<AdminShell {...props} translateNav={next} />);
  expect(next).toHaveBeenCalledTimes(1);
  expect(translateNav).toHaveBeenCalledTimes(2);
});

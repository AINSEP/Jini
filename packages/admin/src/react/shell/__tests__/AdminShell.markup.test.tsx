import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AdminShell } from '../AdminShell.js';
import type { AdminShellHostProps } from '../types.js';
import { authenticated, baseFields, ports } from './shell-fixture.js';

// J2 steps 3 and 4: an absent new slot renders exactly the markup the shell rendered before it existed.
// The snapshot was taken before any slot was added; a diff here is a change to what hosts see.
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function shellProps(path: string): AdminShellHostProps {
  const fields = baseFields(ports(path));
  return {
    ...fields, useHostSession: authenticated(),
    slots: {
      ...fields.slots, sidebarHeader: <p>Header slot</p>, sidebarFooter: () => <p>Footer slot</p>, topbar: <p>Topbar slot</p>,
      overlays: () => <p>Overlay slot</p>, assistant: { content: <p>Assistant slot</p>, label: 'Assistant', open: false },
    },
  };
}

it('renders the authenticated shell markup unchanged when no new slot is supplied', () => {
  const { container } = render(<AdminShell {...shellProps('/records/r1')} />);
  expect(container.innerHTML.replace(/_r_[0-9a-z]+_/g, ':id:')).toMatchSnapshot();
});

it('renders the open-drawer markup unchanged when no new slot is supplied', () => {
  const { container, getByRole } = render(<AdminShell {...shellProps('/')} />);
  getByRole('button', { name: 'Open navigation' }).click();
  expect(container.innerHTML.replace(/_r_[0-9a-z]+_/g, ':id:')).toMatchSnapshot();
});

import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ComingSoonNotice } from '../components/ComingSoonNotice.js';

it('publishes the caller handle and status metadata through the current agent API', () => {
  const { container, rerender } = render(<ComingSoonNotice kicker="Tools" label="Reports" description="Coming soon." agentHandle="reports-notice" />);
  expect(container.firstElementChild).toHaveAttribute('data-agent-element', 'reports-notice');
  expect(container.firstElementChild).toHaveAttribute('data-agent-role', 'status');
  expect(container.firstElementChild).toHaveAttribute('data-agent-label', 'Reports');
  rerender(<ComingSoonNotice kicker="Tools" label="Reports" description="Coming soon." />);
  expect(container.firstElementChild).not.toHaveAttribute('data-agent-element');
});

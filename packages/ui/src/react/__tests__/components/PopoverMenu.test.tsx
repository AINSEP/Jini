import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PopoverMenu } from '../../components/PopoverMenu.js';

describe('PopoverMenu', () => {
  it('renders children inside a jini-popover wrapper', () => {
    const { container } = render(
      <PopoverMenu>
        <div data-testid="item">row</div>
      </PopoverMenu>,
    );
    const wrap = container.querySelector('.jini-popover');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-testid="item"]')).not.toBeNull();
  });

  it('renders an empty wrapper when given no children', () => {
    const { container } = render(<PopoverMenu />);
    const wrap = container.querySelector('.jini-popover');
    expect(wrap).not.toBeNull();
    expect(wrap?.childNodes.length).toBe(0);
  });

  it('appends a custom className', () => {
    const { container } = render(<PopoverMenu className="automation-popover--schedule" />);
    expect(container.querySelector('.jini-popover.automation-popover--schedule')).not.toBeNull();
  });

  it('carries an agent handle from agentHandle, else from data-agent-element, as a region', () => {
    const { container, rerender } = render(<PopoverMenu agentHandle="schedule-menu" data-agent-page="automations" />);
    const wrap = container.querySelector('.jini-popover');
    expect(wrap).toHaveAttribute('data-agent-element', 'schedule-menu');
    expect(wrap).toHaveAttribute('data-agent-role', 'region');
    expect(wrap).toHaveAttribute('data-agent-page', 'automations');

    rerender(<PopoverMenu agentHandle="schedule-menu" data-agent-element="fallback-menu" />);
    expect(container.querySelector('.jini-popover')).toHaveAttribute('data-agent-element', 'schedule-menu');
    rerender(<PopoverMenu data-agent-element="fallback-menu" />);
    expect(container.querySelector('.jini-popover')).toHaveAttribute('data-agent-element', 'fallback-menu');
  });

  it('carries no handle when opted out or marked private, and passes the private flag through', () => {
    const { container, rerender } = render(<PopoverMenu agentHandle={false} data-agent-element="fallback-menu" />);
    expect(container.querySelector('.jini-popover')).not.toHaveAttribute('data-agent-element');
    expect(container.querySelector('.jini-popover')).not.toHaveAttribute('data-agent-role');

    rerender(<PopoverMenu agentHandle="schedule-menu" data-agent-private="" />);
    const wrap = container.querySelector('.jini-popover');
    expect(wrap).not.toHaveAttribute('data-agent-element');
    expect(wrap).toHaveAttribute('data-agent-private', '');
  });
});

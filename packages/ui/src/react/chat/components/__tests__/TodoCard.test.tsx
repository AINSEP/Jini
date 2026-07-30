import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TodoCard } from '../TodoCard.js';

describe('TodoCard', () => {
  it('shows progress counts and expands to reveal every item', async () => {
    const todos = [
      { content: 'step one', status: 'completed' as const },
      { content: 'step two', status: 'in_progress' as const },
      { content: 'step three', status: 'pending' as const },
    ];
    render(<TodoCard todos={todos} />);
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('step one')).toBeInTheDocument();
    expect(screen.getByText('step three')).toBeInTheDocument();
  });

  it('collapses/expands via the header toggle', async () => {
    const todos = [{ content: 'done thing', status: 'completed' as const }];
    render(<TodoCard todos={todos} />);
    const toggle = screen.getByRole('button', { name: /todos/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the dismiss button only once every todo is complete, and calls onDismiss', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<TodoCard todos={[{ content: 'a', status: 'in_progress' }]} onDismiss={onDismiss} />);
    expect(screen.queryByText('Done')).not.toBeInTheDocument();

    rerender(<TodoCard todos={[{ content: 'a', status: 'completed' }]} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByText('Done'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows the in-progress todo\'s activeForm as the collapsed-header current label', async () => {
    const todos = [{ content: 'write the report', status: 'in_progress' as const, activeForm: 'Writing the report' }];
    const { container } = render(<TodoCard todos={todos} />);
    // Starts expanded (an in-progress todo forces defaultExpanded); collapse it
    // via the toggle to exercise the `!expanded && inProgressTodo` header label.
    const toggle = screen.getByRole('button', { name: /todos/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.op-todo-current')).toHaveTextContent('Writing the report');
  });

  it('falls back to content for the collapsed current label when the in-progress todo has no activeForm', async () => {
    const todos = [{ content: 'write the report', status: 'in_progress' as const }];
    const { container } = render(<TodoCard todos={todos} />);
    const toggle = screen.getByRole('button', { name: /todos/i });
    await userEvent.click(toggle);
    expect(container.querySelector('.op-todo-current')).toHaveTextContent('write the report');
  });

  it('renders the activeForm as the todo-item text for an in-progress item, falling back to content for others', () => {
    const todos = [
      { content: 'in progress content', status: 'in_progress' as const, activeForm: 'In progress active form' },
      { content: 'pending content', status: 'pending' as const },
    ];
    render(<TodoCard todos={todos} />);
    expect(screen.getByText('In progress active form')).toBeInTheDocument();
    expect(screen.getByText('pending content')).toBeInTheDocument();
  });

  it('shows a stopped-item marker for a "stopped" status todo', () => {
    const todos = [{ content: 'was cut short', status: 'stopped' as const }];
    render(<TodoCard todos={todos} />);
    expect(screen.getByText('was cut short')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { TodoItem } from '../../../core/index.js';
import { TodoCard } from '../TodoCard.js';

it.each<{ name: string; todos: TodoItem[]; runStreaming: boolean; expanded: string; count: string; markers: string[] }>([
  { name: 'empty streaming plan', todos: [], runStreaming: true, expanded: 'false', count: '0/0', markers: [] },
  { name: 'pending plan', todos: [{ content: 'pending', status: 'pending' }], runStreaming: false, expanded: 'true', count: '0/1', markers: ['○'] },
  { name: 'stopped plan', todos: [{ content: 'stopped', status: 'stopped' }], runStreaming: false, expanded: 'false', count: '0/1', markers: ['!'] },
  { name: 'completed plan', todos: [{ content: 'done', status: 'completed' }], runStreaming: false, expanded: 'false', count: '1/1', markers: ['✓'] },
  { name: 'completed streaming plan', todos: [{ content: 'done', status: 'completed' }], runStreaming: true, expanded: 'true', count: '1/1', markers: ['✓'] },
  { name: 'multiple active items', todos: [{ content: 'one', status: 'in_progress' }, { content: 'two', status: 'in_progress' }], runStreaming: false, expanded: 'true', count: '2/2', markers: ['◐', '◐'] },
])('keeps the default state and markers for $name', ({ todos, runStreaming, expanded, count, markers }) => {
  const { container } = render(<TodoCard todos={todos} runStreaming={runStreaming} />);
  expect(screen.getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-expanded', expanded);
  expect(container.querySelector('.op-meta')).toHaveTextContent(count);
  expect([...container.querySelectorAll('.todo-check')].map(node => node.textContent?.trim())).toEqual(markers);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
});

it('keeps a manual collapse across updates and uses the first active item with a truthy activeForm', () => {
  const { container, rerender } = render(<TodoCard todos={[{ content: 'first', status: 'in_progress', activeForm: '' }, { content: 'second', status: 'in_progress', activeForm: 'Working' }]} />);
  fireEvent.click(screen.getByRole('button', { name: /Todos/ }));
  expect(container.querySelector('.op-todo-current')).toHaveTextContent('first');
  expect([...container.querySelectorAll('.todo-text')].map(node => node.textContent)).toEqual(['first', 'Working']);
  rerender(<TodoCard todos={[{ content: 'third', status: 'in_progress', activeForm: 'Finishing' }]} runStreaming />);
  expect(screen.getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-expanded', 'false');
  expect(container.querySelector('.op-todo-current')).toHaveTextContent('Finishing');
});

it('requires a nonempty all-completed plan and a dismiss handler before offering Done', () => {
  const onDismiss = vi.fn<() => void>();
  const { rerender } = render(<TodoCard todos={[]} onDismiss={onDismiss} />);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  rerender(<TodoCard todos={[{ content: 'done', status: 'completed' }, { content: 'stopped', status: 'stopped' }]} onDismiss={onDismiss} />);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  rerender(<TodoCard todos={[{ content: 'done', status: 'completed', activeForm: 'Ignored' }]} onDismiss={onDismiss} />);
  expect(screen.queryByText('Ignored')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledWith();
});

/**
 * @module TodoCard
 *
 * Renders a `TodoWrite`-style plan snapshot as a collapsible checklist.
 * Ported from OD's `components/ToolCard.tsx` (`TodoCard`, verified 0 OD
 * product references) with className/structure kept verbatim (`op-*`
 * classes — this package ships unstyled semantic markup, same convention as
 * `@jini-ai/ui`'s already-ported components; a host supplies CSS) and every
 * user-facing string wrapped in `useT()`.
 */
import { useState } from 'react';
import type { TodoItem } from '../../core/index.js';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';

export interface TodoCardProps {
  todos: TodoItem[];
  runStreaming?: boolean;
  onDismiss?: () => void;
}

export function TodoCard({ todos, runStreaming = false, onDismiss }: TodoCardProps) {
  const t = useT();
  const hasInProgress = todos.some((todo) => todo.status === 'in_progress');
  const hasPending = todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress');
  const defaultExpanded = todos.length > 0 && (hasInProgress || hasPending || runStreaming);
  const [overrideExpanded, setOverrideExpanded] = useState<boolean | null>(null);
  const expanded = overrideExpanded ?? defaultExpanded;

  const inProgressTodo = todos.find((todo) => todo.status === 'in_progress');
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const done = todos.filter((todo) => todo.status === 'completed' || todo.status === 'in_progress').length;
  const allComplete = todos.length > 0 && completed === todos.length;
  const showDismiss = Boolean(onDismiss) && allComplete;

  return (
    <div className={`op-card op-todo${expanded ? '' : ' op-todo-collapsed'}`}>
      <div className="op-card-head op-todo-head">
        <button
          type="button"
          className="op-todo-toggle"
          aria-expanded={expanded}
          onClick={() => setOverrideExpanded(!expanded)}
          title={expanded ? t('Collapse todos') : t('Expand todos')}
        >
          <span className="op-icon" aria-hidden>
            ☐
          </span>
          <span className="op-title">{t('Todos')}</span>
          <span className="op-meta">
            {done}/{todos.length}
          </span>
          {!expanded && inProgressTodo ? <span className="op-todo-current">{inProgressTodo.activeForm || inProgressTodo.content}</span> : null}
          <span className="op-todo-chev" aria-hidden>
            {expanded ? <Icon name="chevron-down" size={11} /> : <Icon name="chevron-right" size={11} />}
          </span>
        </button>
        {showDismiss ? (
          <button type="button" className="op-todo-done" onClick={() => onDismiss?.()} title={t('Dismiss')}>
            {t('Done')}
          </button>
        ) : null}
      </div>
      <div className={`accordion-collapsible${expanded ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <ul className="todo-list">
            {todos.map((todo, i) => (
              <li key={i} className={`todo-item todo-${todo.status}`}>
                <span className="todo-check" aria-hidden>
                  {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◐' : todo.status === 'stopped' ? '!' : '○'}
                </span>
                <span className="todo-text">{todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

import { createElement as h, useState } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { TextField } from '../facade.js';
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => cleanup());

function Harness(props: { readonly onSubmit: () => void; readonly labels?: { show: string; hide: string } }) {
  const [value, setValue] = useState('');
  return h('form', { onSubmit: (event: Event) => { event.preventDefault(); props.onSubmit(); } },
    h(TextField, { label: 'API key', type: 'password', value, onValueChange: ({ value: next }) => setValue(next), ...(props.labels ? { secretToggleLabels: props.labels } : {}) }),
    h('button', { type: 'button', onClick: () => setValue('') }, 'Save'));
}

it('a password TextField starts hidden and its eye toggle reveals and re-hides without submitting', () => {
  const onSubmit = vi.fn();
  render(h(Harness, { onSubmit }));
  const input = screen.getByLabelText('API key') as HTMLInputElement;
  const toggle = screen.getByRole('button', { name: 'Show API key' });
  expect(input.type).toBe('password');
  expect(input.getAttribute('spellcheck')).toBe('false');
  expect(toggle.getAttribute('type')).toBe('button');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(toggle.closest('label')).toBeNull();
  fireEvent.change(input, { target: { value: 'sk-123' } });
  fireEvent.click(toggle);
  expect(input.type).toBe('text');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(toggle.getAttribute('aria-label')).toBe('Hide API key');
  fireEvent.click(toggle);
  expect(input.type).toBe('password');
  expect(onSubmit).not.toHaveBeenCalled();
});

it('re-hides once the value is cleared after a save, and takes host-translated names', () => {
  render(h(Harness, { onSubmit: vi.fn(), labels: { show: 'Afficher la clé', hide: 'Masquer la clé' } }));
  const input = screen.getByLabelText('API key') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'sk-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Afficher la clé' }));
  expect(input.type).toBe('text');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(input.type).toBe('password');
  expect(screen.getByRole('button', { name: 'Afficher la clé' }).getAttribute('aria-pressed')).toBe('false');
});

it('can be revealed while still empty, so a paste is visible as it lands', () => {
  render(h(Harness, { onSubmit: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Show API key' }));
  const input = screen.getByLabelText('API key') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'sk-1' } });
  expect(input.type).toBe('text');
});

it('a non-password TextField gets no toggle', () => {
  render(h(TextField, { label: 'Name', value: '', onValueChange: vi.fn() }));
  expect(screen.queryByRole('button')).toBeNull();
});

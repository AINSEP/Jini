import { createElement as h, useState } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { TextField } from '../facade.js';
import { SecretInput } from '../SecretInput.js';
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
  expect(toggle.getAttribute('aria-pressed')).toBeNull();
  expect(toggle.closest('label')).toBeNull();
  fireEvent.change(input, { target: { value: 'sk-123' } });
  fireEvent.click(toggle);
  expect(input.type).toBe('text');
  expect(toggle.getAttribute('aria-pressed')).toBeNull();
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
  expect(screen.getByRole('button', { name: 'Afficher la clé' }).getAttribute('aria-pressed')).toBeNull();
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

const publishedSecret = {
  'data-agent-element': 'secret', 'data-agent-handle': 'legacy-secret',
  'data-agent-role': 'field', 'data-agent-label': 'Secret', 'data-agent-page': 'settings',
  'data-agent-private': false, 'data-testid': 'secret-field',
};

function expectPrivateControl(element: Element) {
  expect(element.getAttribute('data-agent-private')).toBe('');
  expect(element.getAttributeNames().filter(name => name.startsWith('data-agent-'))).toEqual(['data-agent-private']);
}

it('secret inputs suppress caller addressing on both field and reveal button through reveal and rerender', () => {
  const props = { ...publishedSecret, label: 'Token', 'aria-label': 'Token', value: 'fixture-token', readOnly: true,
    toggleAttrs: { ...publishedSecret, 'data-testid': 'secret-toggle' } };
  const { rerender } = render(h(SecretInput, props));
  const input = screen.getByLabelText('Token');
  const toggle = screen.getByRole('button', { name: 'Show Token' });
  expectPrivateControl(input);
  expectPrivateControl(toggle);
  expect(input.getAttribute('data-testid')).toBe('secret-field');
  expect(toggle.getAttribute('data-testid')).toBe('secret-toggle');
  fireEvent.click(toggle);
  expect((input as HTMLInputElement).type).toBe('text');
  expectPrivateControl(input);
  expectPrivateControl(toggle);
  rerender(h(SecretInput, { ...props, value: 'changed-token' }));
  expectPrivateControl(input);
  expectPrivateControl(toggle);
});

it('password TextFields suppress opaque addressing attrs even while revealed', () => {
  render(h(TextField, { label: 'API key', type: 'password', value: 'fixture-key', onValueChange: vi.fn(), attrs: publishedSecret }));
  const input = screen.getByLabelText('API key');
  const toggle = screen.getByRole('button', { name: 'Show API key' });
  expectPrivateControl(input);
  expectPrivateControl(toggle);
  fireEvent.click(toggle);
  expect((input as HTMLInputElement).type).toBe('text');
  expectPrivateControl(input);
  expectPrivateControl(toggle);
});

import { createElement as h, createRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { TextField } from '../facade.js';
import { SecretInput } from '../SecretInput.js';
import { useSecretReveal } from '../secret-reveal.hooks.js';
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

it('portalled secret inputs suppress caller addressing on field and toggle through reveal and rerender', () => {
  const props = { ...publishedSecret, label: 'Token', 'aria-label': 'Token', value: 'fixture-token', readOnly: true,
    toggleAttrs: { ...publishedSecret, 'data-testid': 'secret-toggle' } };
  const { rerender } = render(createPortal(h(SecretInput, props), document.body));
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
  rerender(createPortal(h(SecretInput, { ...props, value: 'changed-token' }), document.body));
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

it('a standalone secret requests both reveal transitions without overriding the host state', () => {
  const ref = createRef<HTMLInputElement>();
  const onRevealedChange = vi.fn();
  const props = { ref, label: 'Token', 'aria-label': 'Token', value: 'fixture-token', readOnly: true,
    toggleLabels: { show: 'Reveal credential', hide: 'Mask credential' }, onRevealedChange };
  const view = render(h(SecretInput, { ...props, revealed: false }));
  const input = screen.getByLabelText('Token') as HTMLInputElement;
  expect(ref.current).toBe(input);
  expect(input.type).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' }));
  expect(input.type).toBe('password');
  expect(onRevealedChange.mock.calls).toEqual([[true]]);

  view.rerender(h(SecretInput, { ...props, revealed: true }));
  const hide = screen.getByRole('button', { name: 'Mask credential' });
  expect(hide.title).toBe('Mask credential');
  expect(input.type).toBe('text');
  fireEvent.click(hide);
  expect(input.type).toBe('text');
  expect(onRevealedChange.mock.calls).toEqual([[true], [false]]);

  view.rerender(h(SecretInput, { ...props, revealed: false, disabled: true }));
  const disabledToggle = screen.getByRole('button', { name: 'Reveal credential' });
  expect(disabledToggle.matches(':disabled')).toBe(true);
  expect(input.type).toBe('password');
  disabledToggle.click();
  expect(onRevealedChange.mock.calls).toEqual([[true], [false]]);
});

it('a standalone secret passes the changing value to the host hook and re-masks when it clears', () => {
  const calls: Parameters<typeof useSecretReveal>[0][] = [];
  const useHostReveal: typeof useSecretReveal = (required, options) => {
    calls.push(required);
    return useSecretReveal(required, options);
  };
  const props = { label: 'Credential', 'aria-label': 'Credential', readOnly: true, useSecretRevealHook: useHostReveal };
  const view = render(h(SecretInput, { ...props, value: 'fixture-credential' }));
  const input = screen.getByLabelText('Credential') as HTMLInputElement;
  fireEvent.click(screen.getByRole('button', { name: 'Show Credential' }));
  expect(input.type).toBe('text');
  view.rerender(h(SecretInput, { ...props, value: 'replacement-credential' }));
  expect(input.type).toBe('text');
  view.rerender(h(SecretInput, { ...props, value: '' }));
  expect(input.type).toBe('password');
  expect(screen.getByRole('button', { name: 'Show Credential' }).getAttribute('title')).toBe('Show Credential');
  expect(calls[0]).toEqual({ value: 'fixture-credential', labels: { show: 'Show Credential', hide: 'Hide Credential' } });
  expect(calls.at(-1)).toEqual({ value: '', labels: { show: 'Show Credential', hide: 'Hide Credential' } });
});

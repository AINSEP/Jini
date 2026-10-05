import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminEntityField } from '../../../core/ports/entities.js';
import { EntityField } from '../EntityField.js';
import { fromDatetimeLocalValue } from '../rules.js';
import type { RelationIndex } from '../rules.js';

const translate = ({ key }: { readonly key: string }) => `tr:${key}`;
const relations: RelationIndex = { authors: { options: [{ id: 'a1', title: 'Ada' }], titles: { a1: 'Ada' }, truncated: false } };

function field({ spec, value, text = '' }: { spec: AdminEntityField; value: unknown; text?: string }) {
  const onChange = vi.fn(), onTextChange = vi.fn();
  const view = render(<EntityField inputId="f" field={spec} value={value} text={text} relations={relations} translate={translate}
    disabled={false} invalid={false} onChange={onChange} onTextChange={onTextChange} />);
  return { onChange, onTextChange, ...view };
}
function pick({ combobox, option }: { combobox: string; option: string }) {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

afterEach(cleanup);

describe('EntityField', () => {
  it('relation: shows an unresolved stored id, selects a target row, and clears to undefined', () => {
    const { onChange } = field({ spec: { name: 'authorId', kind: 'relation', target: 'authors', label: 'Author' }, value: 'a9' });
    const combobox = screen.getByRole('combobox', { name: 'tr:Author' });
    expect(combobox.textContent).toBe('a9 (tr:Unresolved)');
    pick({ combobox: 'tr:Author', option: 'Ada' });
    expect(onChange).toHaveBeenLastCalledWith({ value: 'a1' });
    pick({ combobox: 'tr:Author', option: 'tr:No value' });
    expect(onChange).toHaveBeenLastCalledWith({ value: undefined });
  });

  it('relation: an unknown target and a non-string value offer only "No value"', () => {
    field({ spec: { name: 'ownerId', kind: 'relation', target: 'owners' }, value: 7 });
    fireEvent.click(screen.getByRole('combobox', { name: 'tr:ownerId' }));
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['tr:No value']);
  });

  it('relation: a long option list gets a search box translated through the host dictionary', () => {
    const many: RelationIndex = { tags: { options: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Tag ${i}` })), titles: {}, truncated: false } };
    render(<EntityField inputId="g" field={{ name: 'tagId', kind: 'relation', target: 'tags' }} value="t1" text="" relations={many}
      translate={translate} disabled={false} invalid={false} onChange={vi.fn()} onTextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'tr:tagId' }));
    expect(screen.getByRole('textbox', { name: 'tr:Search options' })).toBeTruthy();
  });

  it('required boolean is a checkbox reporting its checked state', () => {
    const { onChange } = field({ spec: { name: 'active', kind: 'boolean', required: true }, value: false });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith({ value: true });
  });

  it.each([
    [undefined, 'tr:No value'], [true, 'tr:Yes'], [false, 'tr:No'],
  ])('optional boolean %s shows %s and maps choices back to booleans', (value, label) => {
    const { onChange } = field({ spec: { name: 'featured', kind: 'boolean', label: 'Featured' }, value });
    expect(screen.getByRole('combobox', { name: 'tr:Featured' }).textContent).toBe(label);
    pick({ combobox: 'tr:Featured', option: 'tr:Yes' });
    expect(onChange).toHaveBeenLastCalledWith({ value: true });
    pick({ combobox: 'tr:Featured', option: 'tr:No' });
    expect(onChange).toHaveBeenLastCalledWith({ value: false });
    pick({ combobox: 'tr:Featured', option: 'tr:No value' });
    expect(onChange).toHaveBeenLastCalledWith({ value: undefined });
  });

  it('optional boolean without a label is named by the field name', () => {
    field({ spec: { name: 'featured', kind: 'boolean' }, value: undefined });
    expect(screen.getByRole('combobox', { name: 'tr:featured' })).toBeTruthy();
  });

  it('datetime converts the local input value through the shared rule', () => {
    const { onChange, container } = field({ spec: { name: 'at', kind: 'datetime' }, value: undefined });
    const input = container.querySelector('input')!;
    expect(input.getAttribute('type')).toBe('datetime-local');
    fireEvent.change(input, { target: { value: '2026-10-04T12:30' } });
    expect(onChange).toHaveBeenCalledWith({ value: fromDatetimeLocalValue({ raw: '2026-10-04T12:30' }) });
    expect(onChange.mock.calls[0]![0].value).toEqual(expect.any(String));
  });

  it.each([['integer', '1'], ['real', 'any']] as const)('%s inputs step by %s and parse numbers', (kind, step) => {
    const { onChange, container } = field({ spec: { name: 'n', kind }, value: 'not a number' });
    const input = container.querySelector('input')!;
    expect([input.getAttribute('type'), input.getAttribute('step'), input.value]).toEqual(['number', step, '']);
    fireEvent.change(input, { target: { value: '4.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ value: 4.5 });
  });

  it('a number field shows a numeric value and reports a cleared one as undefined', () => {
    const { container, onChange } = field({ spec: { name: 'n', kind: 'integer' }, value: 3 });
    const input = container.querySelector('input')!;
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ value: undefined });
  });

  it('text inputs report blanks as undefined and ignore non-string values', () => {
    const { onChange, container } = field({ spec: { name: 'title', kind: 'text' }, value: 12 });
    const input = container.querySelector('input')!;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenLastCalledWith({ value: 'Hello' });
  });

  it('a cleared text input reports undefined', () => {
    const { onChange, container } = field({ spec: { name: 'title', kind: 'text' }, value: 'Hello' });
    fireEvent.change(container.querySelector('input')!, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ value: undefined });
  });

  it('json edits raw text', () => {
    const { onTextChange, onChange, container } = field({ spec: { name: 'payload', kind: 'json' }, value: { x: 1 }, text: '{"x":1}' });
    const area = container.querySelector('textarea')!;
    expect(area.value).toBe('{"x":1}');
    fireEvent.change(area, { target: { value: '{"x":2}' } });
    expect(onTextChange).toHaveBeenCalledWith({ text: '{"x":2}' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

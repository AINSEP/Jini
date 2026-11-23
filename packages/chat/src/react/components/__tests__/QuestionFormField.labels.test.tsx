import { render, screen } from '../../__tests__/ui-kit-render-support.js';
import { describe, expect, it, vi } from 'vitest';
import type { FormQuestion, QuestionForm as QuestionFormType } from '../../../core/index.js';
import { QuestionForm } from '../QuestionForm.js';

// B246: the visible <label class="qf-label"> wrapped only its own text and had no `for`, so it named
// nothing — clicking it did not reach the control, and a label with no control is an orphan. Each
// single control now carries a useId id and the label points at it.
const SINGLE_CONTROLS: Array<[string, FormQuestion]> = [
  ['text', { id: 't', label: 'Project name', type: 'text' }],
  ['textarea', { id: 'a', label: 'Summary', type: 'textarea' }],
  ['select', { id: 's', label: 'Region', type: 'select', options: [{ label: 'EU', value: 'eu' }] }],
  ['number', { id: 'n', label: 'Team size', type: 'number' }],
  ['range', { id: 'r', label: 'Budget', type: 'range', min: 0, max: 10 }],
  ['email', { id: 'e', label: 'Contact email', type: 'email' }],
  ['color', { id: 'c', label: 'Accent color', type: 'color' }],
  ['file', { id: 'f', label: 'Logo file', type: 'file' }],
  ['switch', { id: 'w', label: 'Agree', type: 'switch' }],
];

function renderOne(question: FormQuestion, formId = 'f') {
  const form: QuestionFormType = { id: formId, title: 'Form title', questions: [question] };
  return render(<QuestionForm form={form} interactive onSubmit={vi.fn()} />);
}

function labelOf(container: HTMLElement, text: string): HTMLLabelElement {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label.qf-label')).find((el) => el.textContent?.startsWith(text));
  if (!label) throw new Error(`no qf-label for ${text}`);
  return label;
}

describe('QuestionForm field labels', () => {
  it.each(SINGLE_CONTROLS)('the visible label of a %s question is associated with its control', (_type, question) => {
    const { container } = renderOne(question);
    const control = screen.getByLabelText(question.label);
    expect(control.id).not.toBe('');
    expect(labelOf(container, question.label).control).toBe(control);
  });

  it('two forms showing the same question never share a control id', () => {
    const question: FormQuestion = { id: 'name', label: 'Project name', type: 'text' };
    const a = renderOne(question, 'one');
    const b = renderOne(question, 'two');
    const first = a.container.querySelector('input')!;
    const second = b.container.querySelector('input')!;
    expect(first.id).not.toBe(second.id);
    expect(labelOf(a.container, 'Project name').control).toBe(first);
    expect(labelOf(b.container, 'Project name').control).toBe(second);
  });

  it('a radio group label is not tied to its first option', () => {
    const { container } = renderOne({ id: 'p', label: 'Platform', type: 'radio', options: [{ label: 'Mobile', value: 'mobile' }, { label: 'Desktop', value: 'desktop' }] });
    expect(labelOf(container, 'Platform').control).toBeNull();
  });
});

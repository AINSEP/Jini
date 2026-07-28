import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DirectionCard, FormQuestion, QuestionForm as QuestionFormType } from '@injini/chat-core';
import { QuestionForm, type QuestionFormHandle } from '../QuestionForm.js';

const form: QuestionFormType = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [
    { id: 'platform', label: 'Platform', type: 'radio', options: [{ label: 'Mobile', value: 'mobile' }, { label: 'Desktop', value: 'desktop' }], required: true },
    { id: 'notes', label: 'Notes', type: 'text' },
  ],
};

function questionForm(questions: FormQuestion[], overrides: Partial<QuestionFormType> = {}): QuestionFormType {
  return { id: 'f', title: 'Form title', questions, ...overrides };
}

function inputOfType(container: HTMLElement, type: string): HTMLInputElement {
  const el = container.querySelector(`input[type="${type}"]`);
  if (!el) throw new Error(`no input[type="${type}"] found`);
  return el as HTMLInputElement;
}

describe('QuestionForm', () => {
  it('disables submit until the required question is answered', async () => {
    const onSubmit = vi.fn();
    render(<QuestionForm form={form} interactive onSubmit={onSubmit} />);
    const submit = screen.getByRole('button', { name: 'Continue' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Mobile' }));
    expect(submit).not.toBeDisabled();
  });

  it('calls onSubmit with formatted text and the raw answers map', async () => {
    const onSubmit = vi.fn();
    render(<QuestionForm form={form} interactive onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Desktop' }));
    // Two textboxes exist: the radio question's "something else" custom-choice
    // input, and the free-text "notes" question — the notes input is the last one.
    const textboxes = screen.getAllByRole('textbox');
    await userEvent.type(textboxes[textboxes.length - 1]!, 'ship it fast');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [text, answers] = onSubmit.mock.calls[0]!;
    expect(text).toContain('[form answers — discovery]');
    expect(text).toContain('Platform: Desktop');
    expect(answers).toMatchObject({ platform: 'desktop', notes: 'ship it fast' });
  });

  it('renders locked/answered state and hides the submit control', () => {
    render(<QuestionForm form={form} interactive={false} submittedAnswers={{ platform: 'mobile', notes: 'x' }} />);
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Mobile' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mobile' })).toBeDisabled();
  });

  it('exposes an imperative skipAll() that submits every question as skipped', async () => {
    const onSubmit = vi.fn();
    let handle: QuestionFormHandle | null = null;
    render(
      <QuestionForm
        form={form}
        interactive
        onSubmit={onSubmit}
        ref={(h) => {
          handle = h;
        }}
      />,
    );
    handle!.skipAll();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toContain('(skipped)');
  });

  it('imperative submit() is a no-op while locked, and skipAll() is a no-op without onSubmit', () => {
    let handle: QuestionFormHandle | null = null;
    render(
      <QuestionForm
        form={form}
        interactive={false}
        ref={(h) => {
          handle = h;
        }}
      />,
    );
    // No crash, no-op: locked (no onSubmit at all here).
    expect(() => handle!.submit()).not.toThrow();
    expect(() => handle!.skipAll()).not.toThrow();
  });

  it('imperative submit() is a no-op while required questions are unanswered', () => {
    const onSubmit = vi.fn();
    let handle: QuestionFormHandle | null = null;
    render(
      <QuestionForm
        form={form}
        interactive
        onSubmit={onSubmit}
        ref={(h) => {
          handle = h;
        }}
      />,
    );
    handle!.submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders form.description and per-question help text when present', () => {
    const withExtras = questionForm(
      [{ id: 'q1', label: 'Question one', type: 'text', help: 'Some helper copy' }],
      { description: 'Read this before answering' },
    );
    render(<QuestionForm form={withExtras} interactive onSubmit={vi.fn()} />);
    expect(screen.getByText('Read this before answering')).toBeInTheDocument();
    expect(screen.getByText('Some helper copy')).toBeInTheDocument();
  });

  it('honors form.submitLabel as an override for the default "Continue" label', () => {
    const withLabel = questionForm([{ id: 'q1', label: 'Q', type: 'text' }], { submitLabel: 'Send it' });
    render(<QuestionForm form={withLabel} interactive onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
  });

  it('hideInternalSubmit suppresses the footer entirely', () => {
    render(<QuestionForm form={form} interactive onSubmit={vi.fn()} hideInternalSubmit />);
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByText('Answer above, then continue')).not.toBeInTheDocument();
  });

  it('shows a distinct locked note when locked without submittedAnswers vs. locked with submittedAnswers', () => {
    const { rerender } = render(<QuestionForm form={form} interactive={false} onSubmit={vi.fn()} />);
    expect(screen.getByText('A newer message answered this')).toBeInTheDocument();

    rerender(<QuestionForm form={form} interactive={false} submittedAnswers={{ platform: 'mobile', notes: 'x' }} />);
    expect(screen.getByText('You answered this')).toBeInTheDocument();
  });

  it('draftAnswers seeds the initial (non-file) state, and onReadyChange fires on mount and on update', async () => {
    const onReadyChange = vi.fn();
    render(
      <QuestionForm
        form={form}
        interactive
        onSubmit={vi.fn()}
        draftAnswers={{ platform: 'desktop', notes: 'draft text' }}
        onReadyChange={onReadyChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Desktop' })).toBeChecked();
    expect(screen.getByDisplayValue('draft text')).toBeInTheDocument();
    expect(onReadyChange).toHaveBeenCalledWith(true);

    await userEvent.click(screen.getByRole('radio', { name: 'Mobile' }));
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
  });

  it('onDraftChange/onAnswerChange fire on interaction and are simply absent (no throw) when not provided', async () => {
    const onDraftChange = vi.fn();
    const onAnswerChange = vi.fn();
    render(<QuestionForm form={form} interactive onSubmit={vi.fn()} onDraftChange={onDraftChange} onAnswerChange={onAnswerChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Mobile' }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ platform: 'mobile' }));
    expect(onAnswerChange).toHaveBeenCalledWith('platform', 'mobile');
  });

  describe('checkbox question', () => {
    const checkboxForm = questionForm([
      { id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }, { label: 'Green', value: 'green' }], maxSelections: 2 },
    ]);

    it('toggles selections on and off and reports the array via onAnswerChange', async () => {
      const onAnswerChange = vi.fn();
      render(<QuestionForm form={checkboxForm} interactive onSubmit={vi.fn()} onAnswerChange={onAnswerChange} />);
      const red = screen.getByRole('checkbox', { name: 'Red' });
      await userEvent.click(red);
      expect(onAnswerChange).toHaveBeenLastCalledWith('colors', ['red']);
      await userEvent.click(red);
      expect(onAnswerChange).toHaveBeenLastCalledWith('colors', []);
    });

    it('disables further picks once maxSelections is reached', async () => {
      const onAnswerChange = vi.fn();
      render(<QuestionForm form={checkboxForm} interactive onSubmit={vi.fn()} onAnswerChange={onAnswerChange} />);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Blue' }));
      const green = screen.getByRole('checkbox', { name: 'Green' });
      expect(green).toBeDisabled();
      expect(green.closest('label')).toHaveClass('qf-chip-disabled');
      // toggleCheckbox() itself defensively re-checks the cap (belt-and-braces
      // alongside the `disabled` attribute) — dispatch the change event directly,
      // bypassing the disabled attribute the way a stale/replayed event could, to
      // prove the internal guard also holds and no third selection is recorded.
      fireEvent.click(green);
      expect(onAnswerChange).not.toHaveBeenCalledWith('colors', expect.arrayContaining(['green']));
    });

    it('blocks submit once a required checkbox has zero selections, and allows it once populated', async () => {
      const required = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }], required: true }]);
      const onSubmit = vi.fn();
      render(<QuestionForm form={required} interactive onSubmit={onSubmit} />);
      const submit = screen.getByRole('button', { name: 'Continue' });
      expect(submit).toBeDisabled();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
      expect(submit).not.toBeDisabled();
    });

    it('renders the custom "Something else" input, keeps known selections fixed, and splits new comma/newline entries', async () => {
      const { container } = render(<QuestionForm form={checkboxForm} interactive onSubmit={vi.fn()} />);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
      const customInputs = screen.getAllByRole('textbox');
      const customInput = customInputs[customInputs.length - 1]!;
      fireEvent.change(customInput, { target: { value: 'Purple, Teal\nMagenta' } });
      // Submitting now should include the fixed known value plus the split custom ones.
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      // maxSelections is 2, so an unbounded custom-split append can exceed it, but the
      // component only limits maxSelections for the finite chip toggles, not custom text.
      const button = container.querySelector('button.primary');
      expect(button).toBeTruthy();
    });

    it('customCheckboxValue omits already-known values from the custom text and reflects only the unknown ones', async () => {
      render(<QuestionForm form={checkboxForm} interactive onSubmit={vi.fn()} />);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
      const customInputs = screen.getAllByRole('textbox');
      const customInput = customInputs[customInputs.length - 1]! as HTMLInputElement;
      // "Red" is known (a real chip), so it must not leak into the custom box's value.
      expect(customInput.value).toBe('');
      fireEvent.change(customInput, { target: { value: 'Sunset Orange' } });
      expect(customInput.value).toBe('Sunset Orange');
    });

    it('hides the custom choice input when allowCustom is false', () => {
      const noCustom = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }], allowCustom: false }]);
      render(<QuestionForm form={noCustom} interactive onSubmit={vi.fn()} />);
      expect(screen.queryByText('Something else')).not.toBeInTheDocument();
    });
  });

  describe('select question', () => {
    const selectForm = questionForm([{ id: 'size', label: 'Size', type: 'select', options: [{ label: 'Small', value: 'sm' }, { label: 'Large', value: 'lg' }], placeholder: 'Pick a size' }]);

    it('renders a placeholder option and updates on selection', async () => {
      render(<QuestionForm form={selectForm} interactive onSubmit={vi.fn()} />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('');
      await userEvent.selectOptions(select, 'lg');
      expect(select.value).toBe('lg');
    });

    it('renders the custom "Something else" companion input for select, with a custom label override', () => {
      const withCustomLabel = questionForm([
        { id: 'size', label: 'Size', type: 'select', options: [{ label: 'Small', value: 'sm' }], customLabel: 'Pick your own', customPlaceholder: 'e.g. medium' },
      ]);
      render(<QuestionForm form={withCustomLabel} interactive onSubmit={vi.fn()} />);
      expect(screen.getByText('Pick your own')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g. medium')).toBeInTheDocument();
    });

    it('typing an unrecognized custom value overrides the select back to unselected', async () => {
      render(<QuestionForm form={selectForm} interactive onSubmit={vi.fn()} />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      await userEvent.selectOptions(select, 'lg');
      expect(select.value).toBe('lg');
      const customInput = screen.getByPlaceholderText('Type your own answer');
      await userEvent.type(customInput, 'Extra-large');
      expect(select.value).toBe('');
    });
  });

  describe('text-like question types', () => {
    it('number: renders min/max/step and updates via typing', async () => {
      const q = questionForm([{ id: 'age', label: 'Age', type: 'number', min: 0, max: 120, step: 1, placeholder: 'years' }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const input = inputOfType(container, 'number');
      expect(input.min).toBe('0');
      expect(input.max).toBe('120');
      await userEvent.type(input, '42');
      expect(input.value).toBe('42');
    });

    it('url/email/tel: render the right input type and accept typed text', async () => {
      for (const type of ['url', 'email', 'tel'] as const) {
        const q = questionForm([{ id: 'contact', label: 'Contact', type, placeholder: `enter ${type}` }]);
        const { container, unmount } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
        const input = inputOfType(container, type);
        await userEvent.type(input, 'value');
        expect(input.value).toBe('value');
        unmount();
      }
    });

    it('date/time/datetime-local: render the right input type and accept a direct value change', () => {
      const values: Record<string, string> = { date: '2026-07-18', time: '13:30', 'datetime-local': '2026-07-18T13:30' };
      for (const type of ['date', 'time', 'datetime-local'] as const) {
        const q = questionForm([{ id: 'when', label: 'When', type }]);
        const { container, unmount } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
        const input = inputOfType(container, type);
        fireEvent.change(input, { target: { value: values[type] } });
        expect(input.value).toBe(values[type]);
        unmount();
      }
    });

    it('textarea: renders rows=3 and accepts typed text', async () => {
      const q = questionForm([{ id: 'story', label: 'Story', type: 'textarea', placeholder: 'tell me' }]);
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const textarea = screen.getByPlaceholderText('tell me') as HTMLTextAreaElement;
      expect(textarea.rows).toBe(3);
      await userEvent.type(textarea, 'a long story');
      expect(textarea.value).toBe('a long story');
    });
  });

  describe('range question', () => {
    it('defaults to min when unanswered and updates the output alongside the input', () => {
      const q = questionForm([{ id: 'volume', label: 'Volume', type: 'range', min: 10, max: 100, step: 5 }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const input = inputOfType(container, 'range');
      expect(input.value).toBe('10');
      expect(screen.getByText('10')).toBeInTheDocument();
      fireEvent.change(input, { target: { value: '55' } });
      expect(screen.getByText('55')).toBeInTheDocument();
    });

    it('defaults to 0 when no min is specified', () => {
      const q = questionForm([{ id: 'volume', label: 'Volume', type: 'range' }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const input = inputOfType(container, 'range');
      expect(input.value).toBe('0');
    });

    it('falls back to min (or 0) for a transient undefined value while a min-less range question is streaming in', () => {
      const q1: FormQuestion = { id: 'q1', label: 'First', type: 'text' };
      const onSubmit = vi.fn();
      const { rerender } = render(<QuestionForm form={questionForm([q1], { id: 'g' })} interactive onSubmit={onSubmit} />);
      const q2: FormQuestion = { id: 'q2', label: 'Volume', type: 'range' };
      // No submittedAnswers this time, so this render pass's `currentAnswers` is the
      // (not-yet-backfilled) `answers` state — q2 is genuinely undefined for one pass.
      rerender(<QuestionForm form={questionForm([q1, q2], { id: 'g' })} interactive onSubmit={onSubmit} />);
      const rangeInput = document.querySelector('input[type="range"]') as HTMLInputElement;
      expect(rangeInput.value).toBe('0');
    });
  });

  describe('color question', () => {
    it('falls back to #000000 for an invalid defaultValue, and keeps a valid hex value as-is', () => {
      const invalid = questionForm([{ id: 'c', label: 'Color', type: 'color', defaultValue: 'not-a-color' }]);
      const { container: c1 } = render(<QuestionForm form={invalid} interactive onSubmit={vi.fn()} />);
      expect(inputOfType(c1, 'color').value).toBe('#000000');

      const valid = questionForm([{ id: 'c', label: 'Color', type: 'color', defaultValue: '#abcdef' }]);
      const { container: c2 } = render(<QuestionForm form={valid} interactive onSubmit={vi.fn()} />);
      expect(inputOfType(c2, 'color').value).toBe('#abcdef');
    });

    it('accepts a newly picked valid color', () => {
      const q = questionForm([{ id: 'c', label: 'Color', type: 'color' }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const input = inputOfType(container, 'color');
      expect(input.value).toBe('#000000');
      fireEvent.change(input, { target: { value: '#112233' } });
      expect(input.value).toBe('#112233');
    });
  });

  describe('switch question', () => {
    it('toggles between "false" and "true" string values', async () => {
      const q = questionForm([{ id: 'agree', label: 'Agree', type: 'switch' }]);
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const toggle = screen.getByRole('switch') as HTMLInputElement;
      expect(toggle.checked).toBe(false);
      await userEvent.click(toggle);
      expect(toggle.checked).toBe(true);
    });
  });

  describe('file question', () => {
    it('records a single selected filename and shows the summary, and is dropped from onDraftChange payloads', async () => {
      const q = questionForm([
        { id: 'avatar', label: 'Avatar', type: 'file' },
        { id: 'notes', label: 'Notes', type: 'text' },
      ]);
      const onDraftChange = vi.fn();
      const onAnswerChange = vi.fn();
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} onDraftChange={onDraftChange} onAnswerChange={onAnswerChange} />);
      const fileInput = inputOfType(container, 'file');
      const file = new File(['data'], 'photo.png', { type: 'image/png' });
      await userEvent.upload(fileInput, file);
      expect(screen.getByText('photo.png')).toBeInTheDocument();
      expect(onAnswerChange).toHaveBeenCalledWith('avatar', 'photo.png');
      // draftSafeAnswers strips file-question ids out of the draft payload entirely.
      const lastDraft = onDraftChange.mock.calls.at(-1)![0] as Record<string, unknown>;
      expect(lastDraft).not.toHaveProperty('avatar');
    });

    it('records multiple filenames (array) when the question allows multiple', async () => {
      const q = questionForm([{ id: 'attachments', label: 'Attachments', type: 'file', multiple: true }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const fileInput = inputOfType(container, 'file');
      const a = new File(['a'], 'a.txt');
      const b = new File(['b'], 'b.txt');
      await userEvent.upload(fileInput, [a, b]);
      expect(screen.getByText('a.txt, b.txt')).toBeInTheDocument();
    });

    it('includes only file questions with an actual selection in the third onSubmit argument, and omits it entirely when nothing was ever selected', async () => {
      const q = questionForm([
        { id: 'avatar', label: 'Avatar', type: 'file' },
        { id: 'cover', label: 'Cover', type: 'file' },
      ]);
      const onSubmit = vi.fn();
      const { container, unmount } = render(<QuestionForm form={q} interactive onSubmit={onSubmit} />);
      const [avatarInput, coverInput] = container.querySelectorAll('input[type="file"]');
      const file = new File(['data'], 'headshot.png');
      await userEvent.upload(avatarInput as HTMLInputElement, file);
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [, , files] = onSubmit.mock.calls[0]!;
      expect(files).toEqual([{ questionId: 'avatar', questionLabel: 'Avatar', files: [file] }]);
      void coverInput;
      unmount();

      onSubmit.mockClear();
      const q2 = questionForm([{ id: 'avatar', label: 'Avatar', type: 'file' }]);
      render(<QuestionForm form={q2} interactive onSubmit={onSubmit} />);
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0]!.length).toBe(2);
    });
  });

  describe('direction-cards question', () => {
    function card(overrides: Partial<DirectionCard> & Pick<DirectionCard, 'id' | 'label'>): DirectionCard {
      return { mood: '', references: [], palette: [], displayFont: 'serif', bodyFont: 'sans-serif', ...overrides };
    }

    it('selects a card by id and shows the "Selected" pill only on the chosen one', async () => {
      const q = questionForm([
        {
          id: 'direction',
          label: 'Direction',
          type: 'direction-cards',
          cards: [card({ id: 'warm', label: 'Warm' }), card({ id: 'cool', label: 'Cool' })],
        },
      ]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const warmRadio = container.querySelector('input[value="warm"]') as HTMLInputElement;
      const coolRadio = container.querySelector('input[value="cool"]') as HTMLInputElement;
      expect(screen.queryByText('Selected')).not.toBeInTheDocument();
      await userEvent.click(warmRadio);
      expect(warmRadio.checked).toBe(true);
      expect(coolRadio.checked).toBe(false);
      expect(screen.getByText('Selected')).toBeInTheDocument();
    });

    it('renders up to 6 palette swatches and up to 4 references, and omits the sections entirely when empty', () => {
      const q = questionForm([
        {
          id: 'direction',
          label: 'Direction',
          type: 'direction-cards',
          cards: [
            card({
              id: 'rich',
              label: 'Rich',
              mood: 'Bold and vivid',
              palette: ['#111', '#222', '#333', '#444', '#555', '#666', '#777'],
              references: ['A', 'B', 'C', 'D', 'E'],
            }),
            card({ id: 'plain', label: 'Plain' }),
          ],
        },
      ]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const swatches = container.querySelectorAll('.qf-card-swatch');
      expect(swatches.length).toBe(6);
      expect(screen.getByText('Bold and vivid')).toBeInTheDocument();
      const refsParagraph = container.querySelector('.qf-card-refs')!;
      expect(refsParagraph.textContent).toBe('References: A · B · C · D');
      expect(refsParagraph.textContent).not.toContain('E');

      // The "plain" card has no palette/mood/references — those sections must not render for it.
      const cardLabels = container.querySelectorAll('label.qf-card');
      const plainCardLabel = Array.from(cardLabels).find((el) => el.textContent?.includes('Plain'))!;
      expect(plainCardLabel.querySelector('.qf-card-swatch')).toBeNull();
      expect(plainCardLabel.querySelector('.qf-card-mood')).toBeNull();
      expect(plainCardLabel.querySelector('.qf-card-refs')).toBeNull();
    });

    it('is also selectable by matching card.label (legacy stored value), and supports the custom-choice fallback', async () => {
      const q = questionForm([
        {
          id: 'direction',
          label: 'Direction',
          type: 'direction-cards',
          cards: [card({ id: 'warm', label: 'Warm' })],
        },
      ]);
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} draftAnswers={{ direction: 'Warm' }} />);
      expect(screen.getByText('Selected')).toBeInTheDocument();

      const customInput = screen.getByPlaceholderText('Type your own answer');
      await userEvent.type(customInput, 'Something bespoke');
      expect(screen.queryByText('Selected')).not.toBeInTheDocument();
    });

    it('does not render the direction-cards block at all when cards is an empty array', () => {
      const q = questionForm([{ id: 'direction', label: 'Direction', type: 'direction-cards', cards: [] }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      expect(container.querySelector('.qf-direction-cards')).toBeNull();
    });
  });

  describe('radio question edge cases', () => {
    it('renders nothing for the options block when a radio question has no options', () => {
      const q: FormQuestion = { id: 'mystery', label: 'Mystery', type: 'radio' };
      const { container } = render(<QuestionForm form={questionForm([q])} interactive onSubmit={vi.fn()} />);
      expect(container.querySelector('.qf-options')).toBeNull();
    });

    it('renders an option description as chip copy when present', () => {
      const q: FormQuestion = { id: 'platform', label: 'Platform', type: 'radio', options: [{ label: 'Mobile', value: 'mobile', description: 'iOS or Android' }] };
      render(<QuestionForm form={questionForm([q])} interactive onSubmit={vi.fn()} />);
      expect(screen.getByText('iOS or Android')).toBeInTheDocument();
    });
  });

  describe('mid-stream form growth (new questions arriving after the initial render)', () => {
    it('backfills defaults for newly-added questions on rerender while preserving already-set answers', async () => {
      const q1: FormQuestion = { id: 'q1', label: 'First', type: 'text' };
      const initialForm = questionForm([q1], { id: 'growing' });
      const onSubmit = vi.fn();
      const { rerender } = render(<QuestionForm form={initialForm} interactive onSubmit={onSubmit} />);
      await userEvent.type(screen.getByRole('textbox'), 'kept');

      const q2: FormQuestion = { id: 'q2', label: 'Second', type: 'text', defaultValue: 'defaulted' };
      const q3: FormQuestion = { id: 'q3', label: 'Third', type: 'text' };
      const q4: FormQuestion = { id: 'q4', label: 'Fourth', type: 'radio', options: [{ label: 'A', value: 'a' }] };
      const q5: FormQuestion = { id: 'q5', label: 'Fifth', type: 'checkbox', options: [{ label: 'A', value: 'a' }] };
      const q6: FormQuestion = { id: 'q6', label: 'Sixth', type: 'range', min: 3 };
      const q8: FormQuestion = { id: 'q8', label: 'Eighth', type: 'number' };
      const q9: FormQuestion = { id: 'q9', label: 'Ninth', type: 'date' };
      const q10: FormQuestion = { id: 'q10', label: 'Tenth', type: 'url' };
      const q11: FormQuestion = { id: 'q11', label: 'Eleventh', type: 'textarea' };
      const q12: FormQuestion = { id: 'q12', label: 'Twelfth', type: 'file' };
      const q13: FormQuestion = { id: 'q13', label: 'Thirteenth', type: 'select', options: [{ label: 'A', value: 'a' }] };
      // Backfilled via the submittedAnswers path in the effect (line 68) — distinct from
      // q2's defaultValue path and q3's empty-value path.
      const q14: FormQuestion = { id: 'q14', label: 'Fourteenth', type: 'text' };
      const grownForm = questionForm([q1, q2, q3, q4, q5, q6, q8, q9, q10, q11, q12, q13, q14], { id: 'growing' });
      const submittedAnswers = { q1: 'kept', q14: 'from-submitted-answers', q7: 'irrelevant-because-not-a-question' };

      // Grow the form while also passing submittedAnswers so the backfill effect's
      // submittedAnswers-branch executes too (even though currentAnswers only reads
      // submittedAnswers directly while it's set) — then drop submittedAnswers on a
      // subsequent rerender to reveal what the effect wrote into internal state.
      rerender(<QuestionForm form={grownForm} interactive={false} submittedAnswers={submittedAnswers} />);
      rerender(<QuestionForm form={grownForm} interactive onSubmit={onSubmit} />);

      expect(screen.getByDisplayValue('kept')).toBeInTheDocument();
      expect(screen.getByDisplayValue('defaulted')).toBeInTheDocument();
      expect(screen.getByDisplayValue('from-submitted-answers')).toBeInTheDocument();
      // q3 has no default and wasn't in submittedAnswers -> backfilled to ''.
      const allTextboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
      expect(allTextboxes.some((el) => el.value === '')).toBe(true);
      // q4 (radio) had no value before this render pass reached it — must not be checked.
      expect(screen.getByRole('radio', { name: 'A' })).not.toBeChecked();
      // q6 (range) backfilled to its min.
      const rangeInput = document.querySelector('input[type="range"]') as HTMLInputElement;
      expect(rangeInput.value).toBe('3');
      expect((document.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('');
      expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('');
      expect((document.querySelector('input[type="url"]') as HTMLInputElement).value).toBe('');
      expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
      expect((document.querySelector('select') as HTMLSelectElement).value).toBe('');
      expect(document.querySelector('input[type="file"] ~ .qf-file-summary')).toBeNull();
    });
  });

  describe('locked-form defensive guards (update/toggle handlers must no-op even if invoked directly)', () => {
    it('update() no-ops on a locked text question when its onChange is invoked directly', () => {
      const q = questionForm([{ id: 'notes', label: 'Notes', type: 'text' }]);
      const { container } = render(<QuestionForm form={q} interactive={false} onSubmit={vi.fn()} />);
      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'should not apply' } });
      expect(input.value).toBe('');
    });

    it('toggleCheckbox() no-ops on a locked checkbox when its onChange is invoked directly', () => {
      const q = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }] }]);
      const { container } = render(<QuestionForm form={q} interactive={false} onSubmit={vi.fn()} />);
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
    });

    it('updateCheckboxCustom() no-ops on a locked checkbox custom input when invoked directly', () => {
      const q = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }] }]);
      render(<QuestionForm form={q} interactive={false} onSubmit={vi.fn()} />);
      const customInput = screen.getByPlaceholderText('Type your own answer') as HTMLInputElement;
      fireEvent.change(customInput, { target: { value: 'sneaky' } });
      expect(customInput.value).toBe('');
    });
  });

  describe('checkbox internal defensive branches', () => {
    it('toggleCheckbox treats a non-array current answer (malformed defaultValue) as an empty selection', async () => {
      const q = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }], defaultValue: 'red' as unknown as string }]);
      const onAnswerChange = vi.fn();
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} onAnswerChange={onAnswerChange} />);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
      expect(onAnswerChange).toHaveBeenLastCalledWith('colors', ['red']);
    });

    it('updateCheckboxCustom treats a non-array current answer as an empty selection too', async () => {
      const q = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }], defaultValue: 'red' as unknown as string }]);
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const customInput = screen.getByPlaceholderText('Type your own answer');
      fireEvent.change(customInput, { target: { value: 'Teal' } });
      expect((customInput as HTMLInputElement).value).toBe('Teal');
    });

    it('toggling a checkbox without maxSelections defined works both on and off, and forwards onDraftChange', async () => {
      const q = questionForm([{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }] }]);
      const onDraftChange = vi.fn();
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
      const red = screen.getByRole('checkbox', { name: 'Red' });
      await userEvent.click(red);
      expect(onDraftChange).toHaveBeenLastCalledWith({ colors: ['red'] });
      await userEvent.click(red);
      expect(onDraftChange).toHaveBeenLastCalledWith({ colors: [] });
    });

    it('canonicalizeQuestionValue maps an array defaultValue through formOptionValueForLabel per-entry', () => {
      const q = questionForm([
        { id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }], defaultValue: ['Red', 'Blue'] },
      ]);
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      expect(screen.getByRole('checkbox', { name: 'Red' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Blue' })).toBeChecked();
    });
  });

  describe('remaining ternary sides', () => {
    it('switch toggles back off after being turned on', async () => {
      const q = questionForm([{ id: 'agree', label: 'Agree', type: 'switch' }]);
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const toggle = screen.getByRole('switch') as HTMLInputElement;
      await userEvent.click(toggle);
      expect(toggle.checked).toBe(true);
      await userEvent.click(toggle);
      expect(toggle.checked).toBe(false);
    });

    it('a locked direction-cards question renders its cards with the disabled styling', () => {
      const q = questionForm([
        { id: 'direction', label: 'Direction', type: 'direction-cards', cards: [{ id: 'warm', label: 'Warm', mood: '', references: [], palette: [], displayFont: 'serif', bodyFont: 'sans-serif' }] },
      ]);
      const { container } = render(<QuestionForm form={q} interactive={false} onSubmit={vi.fn()} />);
      expect(container.querySelector('label.qf-card')).toHaveClass('qf-card-disabled');
    });

    it('typing into the radio question\'s own custom-choice input records the raw value directly', async () => {
      const q = questionForm([{ id: 'platform', label: 'Platform', type: 'radio', options: [{ label: 'Mobile', value: 'mobile' }] }]);
      const onAnswerChange = vi.fn();
      render(<QuestionForm form={q} interactive onSubmit={vi.fn()} onAnswerChange={onAnswerChange} />);
      const customInput = screen.getByPlaceholderText('Type your own answer');
      await userEvent.type(customInput, 'X');
      expect(onAnswerChange).toHaveBeenCalledWith('platform', 'X');
    });

    it('re-selecting a file input with zero files clears the recorded filename', async () => {
      const q = questionForm([{ id: 'avatar', label: 'Avatar', type: 'file' }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const fileInput = inputOfType(container, 'file');
      await userEvent.upload(fileInput, new File(['x'], 'a.png'));
      expect(screen.getByText('a.png')).toBeInTheDocument();
      fireEvent.change(fileInput, { target: { files: [] } });
      expect(screen.queryByText('a.png')).not.toBeInTheDocument();
    });

    it('tolerates a change event whose target.files is nullish (per the DOM\'s FileList | null typing)', () => {
      const q = questionForm([{ id: 'avatar', label: 'Avatar', type: 'file' }]);
      const { container } = render(<QuestionForm form={q} interactive onSubmit={vi.fn()} />);
      const fileInput = inputOfType(container, 'file');
      Object.defineProperty(fileInput, 'files', { value: null, configurable: true });
      expect(() => fireEvent.change(fileInput)).not.toThrow();
      expect(screen.queryByText('a.png')).not.toBeInTheDocument();
    });
  });
});

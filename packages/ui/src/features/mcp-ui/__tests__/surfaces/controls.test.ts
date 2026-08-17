import { describe, expect, it } from 'vitest';
import { renderCheckbox } from '../../surfaces/checkbox.js';
import { renderSelect } from '../../surfaces/select.js';
import { renderTextInput } from '../../surfaces/text-input.js';
import { renderFieldControl, toFieldReadSpecs, type SurfaceField } from '../../surfaces/fields.js';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('renderTextInput', () => {
  it('renders a labelled text input with no optional attributes when given none', () => {
    const input = parse(renderTextInput({ name: 'title', label: 'Title' })).querySelector('input')!;
    expect(input.type).toBe('text');
    expect(input.name).toBe('title');
    expect(input.id).toBe('mcpui-field-title');
    expect(input.hasAttribute('value')).toBe(false);
    expect(input.hasAttribute('placeholder')).toBe(false);
    expect(input.required).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('carries value, placeholder, required, disabled and the hint association when given them', () => {
    const doc = parse(
      renderTextInput({
        name: 'title',
        label: 'Title',
        value: 'Hello "world"',
        placeholder: 'A short title',
        hint: 'Shown in search results',
        required: true,
        disabled: true,
      }),
    );
    const input = doc.querySelector('input')!;
    expect(input.value).toBe('Hello "world"');
    expect(input.placeholder).toBe('A short title');
    expect(input.required).toBe(true);
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBe('mcpui-field-title-hint');
  });

  it('renders a number input with its numeric constraints', () => {
    const input = parse(
      renderTextInput({ name: 'weight', label: 'Weight', inputType: 'number', value: 3, min: 0, max: 10, step: 0.5 }),
    ).querySelector('input')!;
    expect(input.type).toBe('number');
    expect(input.value).toBe('3');
    expect(input.min).toBe('0');
    expect(input.max).toBe('10');
    expect(input.step).toBe('0.5');
  });

  it('renders a textarea when multiline, with the value as its text content', () => {
    const textarea = parse(
      renderTextInput({ name: 'body', label: 'Body', multiline: true, rows: 6, value: '<b>hi</b>' }),
    ).querySelector('textarea')!;
    expect(textarea.rows).toBe(6);
    expect(textarea.value).toBe('<b>hi</b>');
    expect(textarea.querySelector('b')).toBeNull();
  });

  it('renders an empty textarea when multiline with no value', () => {
    expect(parse(renderTextInput({ name: 'body', label: 'Body', multiline: true })).querySelector('textarea')!.value).toBe('');
  });

  it('ignores multiline for a number field — there is no multiline number', () => {
    const doc = parse(renderTextInput({ name: 'n', label: 'N', inputType: 'number', multiline: true }));
    expect(doc.querySelector('textarea')).toBeNull();
    expect(doc.querySelector('input')?.type).toBe('number');
  });

  it('omits numeric constraints from a text input even when they are passed', () => {
    const input = parse(renderTextInput({ name: 't', label: 'T', min: 1, max: 2, step: 1 })).querySelector('input')!;
    expect(input.hasAttribute('min')).toBe(false);
  });

  it('renders a masked password input when secret is true, with autocomplete off', () => {
    const input = parse(renderTextInput({ name: 'secretKey', label: 'Secret Key', secret: true })).querySelector('input')!;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('renders a plain text input when secret is omitted or explicitly false, with no autocomplete override', () => {
    const omitted = parse(renderTextInput({ name: 't', label: 'T' })).querySelector('input')!;
    expect(omitted.type).toBe('text');
    expect(omitted.hasAttribute('autocomplete')).toBe(false);

    const explicitFalse = parse(renderTextInput({ name: 't', label: 'T', secret: false })).querySelector('input')!;
    expect(explicitFalse.type).toBe('text');
    expect(explicitFalse.hasAttribute('autocomplete')).toBe(false);
  });

  it('prefers number over secret — there is no masked number input', () => {
    const input = parse(
      renderTextInput({ name: 'n', label: 'N', inputType: 'number', secret: true }),
    ).querySelector('input')!;
    expect(input.type).toBe('number');
  });

  it('ignores multiline for a secret field — there is no masked textarea', () => {
    const doc = parse(renderTextInput({ name: 'p', label: 'P', secret: true, multiline: true }));
    expect(doc.querySelector('textarea')).toBeNull();
    expect(doc.querySelector('input')?.type).toBe('password');
  });
});

describe('renderCheckbox', () => {
  it('renders an unchecked, optional checkbox by default', () => {
    const input = parse(renderCheckbox({ name: 'ack', label: 'I understand' })).querySelector('input')!;
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(false);
    expect(input.required).toBe(false);
    expect(input.disabled).toBe(false);
  });

  it('renders checked, required, disabled and hinted states', () => {
    const doc = parse(
      renderCheckbox({ name: 'ack', label: 'I understand', value: true, required: true, disabled: true, hint: 'Required to proceed' }),
    );
    const input = doc.querySelector('input')!;
    expect(input.checked).toBe(true);
    expect(input.required).toBe(true);
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBe('mcpui-field-ack-hint');
    expect(doc.querySelector('label')?.getAttribute('for')).toBe('mcpui-field-ack');
  });
});

describe('renderSelect', () => {
  const OPTIONS = [
    { value: 'draft', label: 'Draft' },
    { value: 'published' },
    { value: 'archived', label: 'Archived', disabled: true },
  ];

  it('renders one option per entry, falling back to the value as the label', () => {
    const options = [...parse(renderSelect({ name: 'status', label: 'Status', options: OPTIONS })).querySelectorAll('option')];
    expect(options.map((option) => option.value)).toEqual(['draft', 'published', 'archived']);
    expect(options.map((option) => option.textContent)).toEqual(['Draft', 'published', 'Archived']);
    expect(options[2]?.disabled).toBe(true);
  });

  it('selects the matching option and adds no placeholder when not required', () => {
    const doc = parse(renderSelect({ name: 'status', label: 'Status', options: OPTIONS, value: 'published' }));
    expect(doc.querySelector('select')?.value).toBe('published');
    expect(doc.querySelector('option[value=""]')).toBeNull();
    expect(doc.querySelector('select')?.required).toBe(false);
  });

  it('adds a selected, disabled placeholder when required with no value, so "unanswered" stays representable', () => {
    const doc = parse(renderSelect({ name: 'status', label: 'Status', options: OPTIONS, required: true }));
    const placeholder = doc.querySelector('option[value=""]')!;
    expect(placeholder.textContent).toBe('—');
    expect((placeholder as HTMLOptionElement).selected).toBe(true);
    expect((placeholder as HTMLOptionElement).disabled).toBe(true);
    expect(doc.querySelector('select')?.required).toBe(true);
  });

  it('uses a custom placeholder label, and leaves it unselected when a value is given', () => {
    const doc = parse(
      renderSelect({ name: 'status', label: 'Status', options: OPTIONS, required: true, placeholder: 'Choose one', value: 'draft' }),
    );
    expect(doc.querySelector('option[value=""]')?.textContent).toBe('Choose one');
    expect(doc.querySelector('select')?.value).toBe('draft');
  });

  it('carries disabled and the hint association', () => {
    const doc = parse(renderSelect({ name: 'status', label: 'Status', options: [], disabled: true, hint: 'Pick carefully' }));
    expect(doc.querySelector('select')?.disabled).toBe(true);
    expect(doc.querySelector('select')?.getAttribute('aria-describedby')).toBe('mcpui-field-status-hint');
  });
});

describe('renderFieldControl', () => {
  const MINIMAL: SurfaceField[] = [
    { kind: 'string', name: 's', label: 'S' },
    { kind: 'number', name: 'n', label: 'N' },
    { kind: 'boolean', name: 'b', label: 'B' },
    { kind: 'enum', name: 'e', label: 'E', options: [{ value: 'one' }] },
  ];

  const FULL: SurfaceField[] = [
    { kind: 'string', name: 's', label: 'S', hint: 'h', required: true, disabled: true, value: 'v', placeholder: 'p', multiline: true, rows: 3 },
    { kind: 'number', name: 'n', label: 'N', hint: 'h', required: true, disabled: true, value: 1, placeholder: 'p', min: 0, max: 9, step: 1 },
    { kind: 'boolean', name: 'b', label: 'B', hint: 'h', required: true, disabled: true, value: true },
    { kind: 'enum', name: 'e', label: 'E', hint: 'h', required: true, disabled: true, value: 'one', placeholder: 'pick', options: [{ value: 'one' }] },
  ];

  it('dispatches each kind to its own control', () => {
    const docs = MINIMAL.map((field) => parse(renderFieldControl(field)));
    expect(docs[0]?.querySelector('input')?.type).toBe('text');
    expect(docs[1]?.querySelector('input')?.type).toBe('number');
    expect(docs[2]?.querySelector('input')?.type).toBe('checkbox');
    expect(docs[3]?.querySelector('select')).not.toBeNull();
  });

  it('forwards every optional property when present', () => {
    const docs = FULL.map((field) => parse(renderFieldControl(field)));
    expect(docs[0]?.querySelector('textarea')?.rows).toBe(3);
    expect(docs[0]?.querySelector('textarea')?.required).toBe(true);
    expect(docs[1]?.querySelector('input')?.max).toBe('9');
    expect(docs[2]?.querySelector('input')?.checked).toBe(true);
    expect(docs[3]?.querySelector('option[value=""]')?.textContent).toBe('pick');
    for (const doc of docs) expect(doc.querySelector('.mcpui-hint')).not.toBeNull();
  });

  it('omits every optional property when absent, rather than emitting empty attributes', () => {
    for (const doc of MINIMAL.map((field) => parse(renderFieldControl(field)))) {
      expect(doc.querySelector('.mcpui-hint')).toBeNull();
      expect(doc.querySelector('.mcpui-required')).toBeNull();
      expect(doc.querySelector('[aria-describedby]')).toBeNull();
    }
  });

  it('forwards secret through a string field to render a masked input', () => {
    const doc = parse(renderFieldControl({ kind: 'string', name: 's', label: 'S', secret: true }));
    expect(doc.querySelector('input')?.type).toBe('password');
  });

  it('renders a plain text input for a string field when secret is absent — no regression against the unmasked path', () => {
    const doc = parse(renderFieldControl({ kind: 'string', name: 's', label: 'S' }));
    expect(doc.querySelector('input')?.type).toBe('text');
  });
});

describe('toFieldReadSpecs', () => {
  it('strips presentation down to what the inline script actually reads', () => {
    expect(
      toFieldReadSpecs([
        { kind: 'string', name: 's', label: 'S', hint: 'ignored', placeholder: 'ignored' },
        { kind: 'boolean', name: 'b', label: 'B', required: true },
      ]),
    ).toEqual([
      { name: 's', label: 'S', kind: 'string', required: false },
      { name: 'b', label: 'B', kind: 'boolean', required: true },
    ]);
  });
});

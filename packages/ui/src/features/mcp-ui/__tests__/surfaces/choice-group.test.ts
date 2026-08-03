/**
 * Radio-presented enums and multi-select checklists, exercised through the real emitted form script.
 *
 * The assertions that matter here are the read-back ones, not the markup ones: a group posts its
 * value through a DOM shape (`form.elements[name]`) that differs from every scalar control's, and
 * differs again between one option and several. Markup assertions would pass on all three.
 */
import { describe, expect, it } from 'vitest';

import { buildFormSurface, renderFormDocument } from '../../surfaces/form.js';
import { renderChoiceGroup } from '../../surfaces/choice-group.js';
import type { UIResourceUri } from '../../resource.js';
import { mountSurface } from './mount-surface.js';

const URI = 'ui://test/choices' as UIResourceUri;

function formWith(fields: Parameters<typeof renderFormDocument>[0]['fields']) {
  return renderFormDocument({
    title: 'Which choice(s) do you want?',
    submitLabel: 'Submit',
    toolName: 'record_choices',
    fields,
  });
}

describe('renderChoiceGroup', () => {
  it('renders radios for a single-selection group and checkboxes for a multiple one', () => {
    const single = renderChoiceGroup({
      name: 'pick',
      label: 'Pick one',
      selection: 'single',
      options: [{ value: 'a' }, { value: 'b' }],
    });
    const multiple = renderChoiceGroup({
      name: 'pick',
      label: 'Pick any',
      selection: 'multiple',
      options: [{ value: 'a' }, { value: 'b' }],
    });

    expect(single.match(/type="radio"/g)).toHaveLength(2);
    expect(multiple.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it('groups with a fieldset and legend rather than a label', () => {
    // A <label for> would name an element that does not exist — every option has its own id — so
    // the association would silently break rather than fail loudly.
    const html = renderChoiceGroup({
      name: 'pick',
      label: 'Pick one',
      selection: 'single',
      options: [{ value: 'a' }],
    });
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    expect(html).not.toContain('<label class="mcpui-label"');
  });

  it('gives each option a distinct id its label points at', () => {
    const html = renderChoiceGroup({
      name: 'pick',
      label: 'Pick one',
      selection: 'single',
      options: [{ value: 'first' }, { value: 'second' }],
    });
    expect(html).toContain('id="mcpui-field-pick-0"');
    expect(html).toContain('for="mcpui-field-pick-0"');
    expect(html).toContain('id="mcpui-field-pick-1"');
    expect(html).toContain('for="mcpui-field-pick-1"');
  });

  it('derives option ids from the index, never the value', () => {
    // An option value is caller data. Values legal in a value attribute but illegal in an id would
    // break the `for` association with no error — the label would just stop being a hit target.
    const html = renderChoiceGroup({
      name: 'pick',
      label: 'Pick one',
      selection: 'multiple',
      options: [{ value: 'has spaces & "quotes"' }],
    });
    expect(html).toContain('id="mcpui-field-pick-0"');
    expect(html).toContain('value="has spaces &amp; &quot;quotes&quot;"');
  });

  it('pre-checks supplied values, and honours only the first for a single-selection group', () => {
    const multiple = renderChoiceGroup({
      name: 'pick',
      label: 'Pick any',
      selection: 'multiple',
      options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      value: ['a', 'c'],
    });
    expect(multiple.match(/ checked/g)).toHaveLength(2);

    // Two checked radios in one group is not a state a human could reach by clicking, so rendering
    // it would put the surface in a shape its own read path cannot describe.
    const single = renderChoiceGroup({
      name: 'pick',
      label: 'Pick one',
      selection: 'single',
      options: [{ value: 'a' }, { value: 'b' }],
      value: ['a', 'b'],
    });
    expect(single.match(/ checked/g)).toHaveLength(1);
  });

  it('ignores a pre-checked value that matches no option', () => {
    const html = renderChoiceGroup({
      name: 'pick',
      label: 'Pick any',
      selection: 'multiple',
      options: [{ value: 'a' }],
      value: ['nonexistent'],
    });
    expect(html).not.toContain(' checked');
  });

  it('disables every option when the group is disabled, and one when the option is', () => {
    const wholeGroup = renderChoiceGroup({
      name: 'pick',
      label: 'Pick any',
      selection: 'multiple',
      options: [{ value: 'a' }, { value: 'b' }],
      disabled: true,
    });
    expect(wholeGroup.match(/ disabled/g)).toHaveLength(2);

    const oneOption = renderChoiceGroup({
      name: 'pick',
      label: 'Pick any',
      selection: 'multiple',
      options: [{ value: 'a', disabled: true }, { value: 'b' }],
    });
    expect(oneOption.match(/ disabled/g)).toHaveLength(1);
  });

  it('points the group hint at the fieldset, not at any one option', () => {
    const html = renderChoiceGroup({
      name: 'pick',
      label: 'Pick any',
      selection: 'multiple',
      options: [{ value: 'a' }],
      hint: 'Choose carefully',
    });
    expect(html).toContain('aria-describedby="mcpui-field-pick-hint"');
    expect(html).toContain('id="mcpui-field-pick-hint"');
  });
});

describe('a radio-presented enum reads back like a select', () => {
  it('posts the checked radio as a plain string', () => {
    const surface = mountSurface(
      formWith([
        {
          kind: 'enum',
          name: 'plan',
          label: 'Which plan?',
          presentation: 'radio',
          options: [{ value: 'basic' }, { value: 'pro' }],
        },
      ]),
    );

    surface.doc.querySelector<HTMLInputElement>('#mcpui-field-plan-1')!.checked = true;
    surface.submit();

    expect(surface.calls).toHaveLength(1);
    expect(surface.calls[0]!.params['plan']).toBe('pro');
  });

  it('treats an unanswered required radio group as missing', () => {
    const surface = mountSurface(
      formWith([
        {
          kind: 'enum',
          name: 'plan',
          label: 'Which plan?',
          presentation: 'radio',
          required: true,
          options: [{ value: 'basic' }, { value: 'pro' }],
        },
      ]),
    );

    surface.submit();

    expect(surface.calls).toHaveLength(0);
    expect(surface.status()).toContain('Which plan?');
    expect(surface.statusState()).toBe('invalid');
  });

  it('still renders a select when presentation is omitted', () => {
    const html = formWith([
      { kind: 'enum', name: 'plan', label: 'Which plan?', options: [{ value: 'basic' }] },
    ]);
    expect(html).toContain('<select');
    expect(html).not.toContain('type="radio"');
  });
});

describe('a multi-enum checklist posts an array', () => {
  it('posts every checked value, in option order', () => {
    const surface = mountSurface(
      formWith([
        {
          kind: 'multi-enum',
          name: 'toppings',
          label: 'Which choice(s) do you want?',
          options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
        },
      ]),
    );

    surface.doc.querySelector<HTMLInputElement>('#mcpui-field-toppings-0')!.checked = true;
    surface.doc.querySelector<HTMLInputElement>('#mcpui-field-toppings-2')!.checked = true;
    surface.submit();

    expect(surface.calls[0]!.params['toppings']).toEqual(['a', 'c']);
  });

  it('posts an empty array when nothing is checked and the field is optional', () => {
    const surface = mountSurface(
      formWith([
        {
          kind: 'multi-enum',
          name: 'toppings',
          label: 'Which choice(s)?',
          options: [{ value: 'a' }, { value: 'b' }],
        },
      ]),
    );

    surface.submit();

    expect(surface.calls).toHaveLength(1);
    expect(surface.calls[0]!.params['toppings']).toEqual([]);
  });

  it('reads a ONE-option checklist correctly — the RadioNodeList trap', () => {
    // form.elements[name] returns the bare input when only one control shares the name, and a
    // RadioNodeList when several do. Every other test here has two or more options, so this is the
    // only one that fails if the normalisation in readField's checkedValues is dropped.
    const surface = mountSurface(
      formWith([
        {
          kind: 'multi-enum',
          name: 'agree',
          label: 'Which choice(s)?',
          options: [{ value: 'only' }],
        },
      ]),
    );

    surface.doc.querySelector<HTMLInputElement>('#mcpui-field-agree-0')!.checked = true;
    surface.submit();

    expect(surface.calls[0]!.params['agree']).toEqual(['only']);
  });

  it('blocks submission when a required checklist has nothing checked', () => {
    const surface = mountSurface(
      formWith([
        {
          kind: 'multi-enum',
          name: 'toppings',
          label: 'Which choice(s)?',
          required: true,
          options: [{ value: 'a' }, { value: 'b' }],
        },
      ]),
    );

    surface.submit();

    expect(surface.calls).toHaveLength(0);
    expect(surface.statusState()).toBe('invalid');
  });

  it('accepts a required checklist once ANY option is checked, not a specific one', () => {
    // The native `required` attribute on a checkbox group means "this box must be checked", which
    // would silently demand the first option. This asserts the second option alone satisfies it.
    const surface = mountSurface(
      formWith([
        {
          kind: 'multi-enum',
          name: 'toppings',
          label: 'Which choice(s)?',
          required: true,
          options: [{ value: 'a' }, { value: 'b' }],
        },
      ]),
    );

    surface.doc.querySelector<HTMLInputElement>('#mcpui-field-toppings-1')!.checked = true;
    surface.submit();

    expect(surface.calls).toHaveLength(1);
    expect(surface.calls[0]!.params['toppings']).toEqual(['b']);
  });

  it('never emits a native required attribute on a checklist option', () => {
    const html = formWith([
      {
        kind: 'multi-enum',
        name: 'toppings',
        label: 'Which choice(s)?',
        required: true,
        options: [{ value: 'a' }, { value: 'b' }],
      },
    ]);
    expect(html).not.toContain('type="checkbox" id="mcpui-field-toppings-0" name="toppings" value="a" required');
    expect(html).toContain('mcpui-required');
  });
});

describe('buildFormSurface with grouped choices', () => {
  it('produces a resource carrying both control types', () => {
    const resource = buildFormSurface({
      uri: URI,
      title: 'Which choice(s) do you want?',
      submitLabel: 'Submit',
      toolName: 'record_choices',
      fields: [
        {
          kind: 'enum',
          name: 'plan',
          label: 'Pick one',
          presentation: 'radio',
          options: [{ value: 'basic' }, { value: 'pro' }],
        },
        {
          kind: 'multi-enum',
          name: 'extras',
          label: 'Pick any',
          options: [{ value: 'x' }, { value: 'y' }],
        },
      ],
    });

    expect(resource.resource.uri).toBe(URI);
    expect(resource.resource.text).toContain('type="radio"');
    expect(resource.resource.text).toContain('type="checkbox"');
  });
});

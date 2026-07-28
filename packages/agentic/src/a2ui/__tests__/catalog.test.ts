import { describe, expect, it } from 'vitest';
import { callableFromOf, createLabCatalog, isComponentAllowed, isFunctionRegistered } from '../catalog.js';
import type { Catalog } from '../catalog.js';

/**
 * Property schemas are exercised through the catalog's own public surface
 * (`catalog.components.get(type)!.propsSchema`) rather than by importing the private schema
 * consts — that is exactly how `interpreter.ts` reaches them, so these tests pin the real
 * contract instead of an implementation detail.
 */
function propsOf(catalog: Catalog, type: string) {
  const spec = catalog.components.get(type);
  if (!spec) throw new Error(`component type "${type}" is not in the catalog`);
  return spec.propsSchema;
}

function accepts(type: string, props: unknown): boolean {
  return propsOf(createLabCatalog(), type).safeParse(props).success;
}

/** Returns the parsed (defaulted) props, failing loudly rather than returning a half-value. */
function parseProps(type: string, props: unknown): Record<string, unknown> {
  const result = propsOf(createLabCatalog(), type).safeParse(props);
  if (!result.success) throw new Error(`expected ${type} props to be valid: ${result.error.issues[0]!.message}`);
  return result.data as Record<string, unknown>;
}

/** The real basic catalog's 18 component types, in its own declaration order. */
const ALL_COMPONENT_TYPES = [
  'Text', 'Image', 'Icon', 'Video', 'AudioPlayer', 'Row', 'Column', 'List', 'Card', 'Tabs',
  'Modal', 'Divider', 'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput',
] as const;

/** The 6 components whose real definition `allOf`s `common_types.json#/$defs/Checkable`. */
const CHECKABLE_TYPES = ['Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput'] as const;

/**
 * A minimal spec-valid props object per component type — only its `required` properties, so these
 * double as "required-ness is enforced as declared" evidence when paired with the omission cases
 * further down.
 */
const MINIMAL_VALID_PROPS: Record<(typeof ALL_COMPONENT_TYPES)[number], Record<string, unknown>> = {
  Text: { text: 'hello' },
  Image: { url: 'https://example.com/a.png' },
  Icon: { name: 'star' },
  Video: { url: 'https://example.com/a.mp4' },
  AudioPlayer: { url: 'https://example.com/a.mp3' },
  Row: { children: ['a'] },
  Column: { children: ['a'] },
  List: { children: ['a'] },
  Card: { child: 'a' },
  Tabs: { tabs: [{ title: 'One', child: 'a' }] },
  Modal: { trigger: 'a', content: 'b' },
  Divider: {},
  Button: { child: 'a', action: { event: { name: 'go' } } },
  TextField: { label: 'Name' },
  CheckBox: { label: 'I agree', value: true },
  ChoicePicker: { options: [{ label: 'A', value: 'a' }], value: ['a'] },
  Slider: { value: 5, max: 10 },
  DateTimeInput: { value: '2026-01-01' },
};

describe('createLabCatalog', () => {
  it('whitelists all 18 real basic-catalog component types', () => {
    const catalog = createLabCatalog();
    for (const type of ALL_COMPONENT_TYPES) {
      expect(isComponentAllowed(catalog, type), type).toBe(true);
    }
    expect(catalog.components.size).toBe(18);
  });

  it('adversarial: a component type not in the real basic catalog is not allowed', () => {
    const catalog = createLabCatalog();
    // 'Checkbox'/'Textfield' are real casing traps — the spec's names are 'CheckBox'/'TextField'.
    for (const type of ['TotallyMadeUp', 'Checkbox', 'Textfield', 'Div', 'Script', '']) {
      expect(isComponentAllowed(catalog, type), type).toBe(false);
    }
  });

  it('exposes all three callableFrom values across its function set', () => {
    const catalog = createLabCatalog();
    expect(callableFromOf(catalog, 'adminReset')).toBe('rendererOnly');
    expect(callableFromOf(catalog, 'logServerEvent')).toBe('agentOnly');
    expect(callableFromOf(catalog, 'greetUser')).toBe('rendererOrAgent');
  });

  it('an unregistered function defaults to rendererOnly per the spec (absent == explicit rendererOnly)', () => {
    const catalog = createLabCatalog();
    expect(isFunctionRegistered(catalog, 'nope')).toBe(false);
    expect(callableFromOf(catalog, 'nope')).toBe('rendererOnly');
  });

  it('produces a fresh, independently-mutable catalog on every call', () => {
    const a = createLabCatalog();
    const b = createLabCatalog();
    expect(a.functions).not.toBe(b.functions);
    expect(a.components).not.toBe(b.components);
  });
});

// -------------------------------------------------------------------------------------------
// Cross-cutting properties that the real catalog gives EVERY component via `allOf` composition.
// Table-driven over all 18 so a future component can't quietly skip one.
// -------------------------------------------------------------------------------------------
describe('every component composes ComponentCommon + its own closure', () => {
  it.each(ALL_COMPONENT_TYPES)('%s accepts its minimal required props', (type) => {
    expect(accepts(type, MINIMAL_VALID_PROPS[type])).toBe(true);
  });

  // Regression: `accessibility` (common_types.json#/$defs/ComponentCommon) is legal on every
  // component, but no props schema listed it and every schema is `.strict()` — so a spec-valid
  // component carrying it was refused outright. Table-driven so it cannot regress for one type.
  it.each(ALL_COMPONENT_TYPES)('%s accepts ComponentCommon.accessibility', (type) => {
    expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], accessibility: { label: 'A label', description: 'A description' } })).toBe(true);
  });

  it.each(ALL_COMPONENT_TYPES)('%s rejects a malformed accessibility object', (type) => {
    expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], accessibility: { label: 'ok', bogus: 1 } })).toBe(false);
  });

  it.each(ALL_COMPONENT_TYPES)('%s accepts the `weight` property all 18 declare', (type) => {
    expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], weight: 2 })).toBe(true);
    expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], weight: 'heavy' })).toBe(false);
  });

  // `unevaluatedProperties: false` on every real component definition.
  it.each(ALL_COMPONENT_TYPES)('%s rejects an unknown property', (type) => {
    expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], notARealProp: 'x' })).toBe(false);
  });

  it.each(CHECKABLE_TYPES)('%s mixes in Checkable and validates its CheckRules', (type) => {
    const withChecks = { ...MINIMAL_VALID_PROPS[type], checks: [{ condition: { call: 'required', args: { value: { path: '/a' } } }, message: 'Required' }] };
    expect(accepts(type, withChecks)).toBe(true);
    // A CheckRule requires `message` — an unvalidated `checks: unknown[]` would let this through.
    expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], checks: [{ condition: true }] })).toBe(false);
  });

  it.each(ALL_COMPONENT_TYPES.filter((t) => !CHECKABLE_TYPES.includes(t as never)))(
    '%s does NOT mix in Checkable (only 6 of the 18 do)',
    (type) => {
      expect(accepts(type, { ...MINIMAL_VALID_PROPS[type], checks: [{ condition: true, message: 'x' }] })).toBe(false);
    },
  );
});

describe('Image', () => {
  it('requires url and defaults fit/variant per the real schema', () => {
    expect(accepts('Image', {})).toBe(false);
    expect(parseProps('Image', { url: 'https://example.com/a.png' })).toMatchObject({ fit: 'fill', variant: 'mediumFeature' });
  });

  it('accepts a DynamicString url (literal, binding, or function call) and an optional description', () => {
    expect(accepts('Image', { url: { path: '/img/src' } })).toBe(true);
    expect(accepts('Image', { url: { call: 'formatString', args: { value: 'x' } } })).toBe(true);
    expect(accepts('Image', { url: 'u', description: 'Alt text' })).toBe(true);
    expect(accepts('Image', { url: 123 })).toBe(false);
  });

  it('closes the fit and variant enums to the real members', () => {
    for (const fit of ['contain', 'cover', 'fill', 'none', 'scaleDown']) {
      expect(accepts('Image', { url: 'u', fit }), fit).toBe(true);
    }
    // 'scale-down' is the CSS spelling; A2UI uses camelCase.
    expect(accepts('Image', { url: 'u', fit: 'scale-down' })).toBe(false);
    for (const variant of ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header']) {
      expect(accepts('Image', { url: 'u', variant }), variant).toBe(true);
    }
    expect(accepts('Image', { url: 'u', variant: 'thumbnail' })).toBe(false);
  });
});

describe('Icon', () => {
  it('accepts any of the 59 real enum names', () => {
    for (const name of ['accountCircle', 'mail', 'star', 'warning', 'volumeUp']) {
      expect(accepts('Icon', { name }), name).toBe(true);
    }
  });

  it('rejects an icon name outside the real enum', () => {
    // Plausible-sounding but not in the spec's list — the exact failure mode a hand-written enum invites.
    for (const name of ['rocket', 'thumbUp', 'Star', 'star-half']) {
      expect(accepts('Icon', { name }), name).toBe(false);
    }
  });

  it('accepts the custom-SVG and data-bound forms of `name`', () => {
    expect(accepts('Icon', { name: { svgPath: 'M10 10 H 90 V 90 H 10 Z' } })).toBe(true);
    expect(accepts('Icon', { name: { svgPath: { path: '/custom/svg/path' } } })).toBe(true);
    expect(accepts('Icon', { name: { path: '/dynamic/icon/name' } })).toBe(true);
  });

  it("rejects a FunctionCall for `name` — Icon's oneOf admits enum | {svgPath} | DataBinding only, NOT DynamicString", () => {
    expect(accepts('Icon', { name: { call: 'formatString', args: { value: 'star' } } })).toBe(false);
  });

  it('requires name', () => {
    expect(accepts('Icon', {})).toBe(false);
  });
});

describe('Video and AudioPlayer', () => {
  it('Video requires url and takes an optional posterUrl', () => {
    expect(accepts('Video', {})).toBe(false);
    expect(accepts('Video', { url: 'https://example.com/v.mp4', posterUrl: 'https://example.com/p.png' })).toBe(true);
    expect(accepts('Video', { url: 'v', description: 'not a Video prop' })).toBe(false);
  });

  it('AudioPlayer requires url and takes an optional description', () => {
    expect(accepts('AudioPlayer', {})).toBe(false);
    expect(accepts('AudioPlayer', { url: 'https://example.com/a.mp3', description: 'Episode 1' })).toBe(true);
    expect(accepts('AudioPlayer', { url: 'a', posterUrl: 'not an AudioPlayer prop' })).toBe(false);
  });
});

describe('List', () => {
  it('requires children and defaults direction/align', () => {
    expect(accepts('List', {})).toBe(false);
    expect(parseProps('List', { children: ['a', 'b'] })).toMatchObject({ direction: 'vertical', align: 'stretch' });
  });

  it('accepts the template ChildList form as well as a static array', () => {
    expect(accepts('List', { children: { componentId: 'row_tpl', path: '/items' } })).toBe(true);
  });

  it("uses `direction`, not Row/Column's `justify`", () => {
    expect(accepts('List', { children: [], direction: 'horizontal' })).toBe(true);
    expect(accepts('List', { children: [], direction: 'sideways' })).toBe(false);
    expect(accepts('List', { children: [], justify: 'center' })).toBe(false);
  });
});

describe('Card and Modal', () => {
  it('Card requires a single child id, not a list', () => {
    expect(accepts('Card', {})).toBe(false);
    expect(accepts('Card', { child: 'form_container' })).toBe(true);
    expect(accepts('Card', { child: ['a', 'b'] })).toBe(false);
  });

  it('Modal requires both trigger and content', () => {
    expect(accepts('Modal', { trigger: 'btn' })).toBe(false);
    expect(accepts('Modal', { content: 'body' })).toBe(false);
    expect(accepts('Modal', { trigger: 'btn', content: 'body' })).toBe(true);
  });
});

describe('Tabs', () => {
  it('requires at least one tab (minItems: 1)', () => {
    expect(accepts('Tabs', { tabs: [] })).toBe(false);
    expect(accepts('Tabs', { tabs: [{ title: 'One', child: 'a' }] })).toBe(true);
  });

  it('requires both title and child on every tab, and closes the tab object', () => {
    expect(accepts('Tabs', { tabs: [{ title: 'One' }] })).toBe(false);
    expect(accepts('Tabs', { tabs: [{ child: 'a' }] })).toBe(false);
    expect(accepts('Tabs', { tabs: [{ title: 'One', child: 'a', icon: 'star' }] })).toBe(false);
  });

  it('accepts a DynamicString tab title', () => {
    expect(accepts('Tabs', { tabs: [{ title: { path: '/tabs/0/title' }, child: 'a' }] })).toBe(true);
  });
});

describe('Divider', () => {
  it('has no required properties beyond `component` and defaults axis to horizontal', () => {
    expect(parseProps('Divider', {})).toMatchObject({ axis: 'horizontal' });
  });

  it('closes the axis enum', () => {
    expect(accepts('Divider', { axis: 'vertical' })).toBe(true);
    expect(accepts('Divider', { axis: 'diagonal' })).toBe(false);
  });
});

describe('TextField', () => {
  it('requires only label — value and placeholder are optional', () => {
    expect(accepts('TextField', {})).toBe(false);
    expect(parseProps('TextField', { label: 'Email' })).toMatchObject({ variant: 'shortText' });
    expect(accepts('TextField', { label: 'Email', value: { path: '/form/email' }, placeholder: 'you@example.com' })).toBe(true);
  });

  it('closes the variant enum to the real members', () => {
    for (const variant of ['longText', 'number', 'shortText', 'obscured']) {
      expect(accepts('TextField', { label: 'L', variant }), variant).toBe(true);
    }
    // HTML-ish guesses that are NOT real A2UI variants.
    for (const variant of ['text', 'password', 'textarea', 'email']) {
      expect(accepts('TextField', { label: 'L', variant }), variant).toBe(false);
    }
  });
});

describe('CheckBox', () => {
  it('requires both label and value', () => {
    expect(accepts('CheckBox', { label: 'I agree' })).toBe(false);
    expect(accepts('CheckBox', { value: true })).toBe(false);
    expect(accepts('CheckBox', { label: 'I agree', value: true })).toBe(true);
  });

  it('types value as DynamicBoolean, not DynamicString', () => {
    expect(accepts('CheckBox', { label: 'x', value: { path: '/form/agreed' } })).toBe(true);
    expect(accepts('CheckBox', { label: 'x', value: 'true' })).toBe(false);
    expect(accepts('CheckBox', { label: 'x', value: 1 })).toBe(false);
  });
});

describe('ChoicePicker', () => {
  it('requires options and value; label is optional', () => {
    expect(accepts('ChoicePicker', { value: [] })).toBe(false);
    expect(accepts('ChoicePicker', { options: [] })).toBe(false);
    expect(accepts('ChoicePicker', { options: [], value: [] })).toBe(true);
  });

  it('defaults variant, displayStyle and filterable per the real schema', () => {
    expect(parseProps('ChoicePicker', { options: [], value: [] })).toMatchObject({
      variant: 'mutuallyExclusive',
      displayStyle: 'checkbox',
      filterable: false,
    });
  });

  it('closes each option to {label, value} with a plain-string value', () => {
    expect(accepts('ChoicePicker', { options: [{ label: 'A', value: 'a' }], value: ['a'] })).toBe(true);
    expect(accepts('ChoicePicker', { options: [{ label: { path: '/l' }, value: 'a' }], value: [] })).toBe(true);
    // `value` on an option is a stable string, deliberately NOT a DynamicString.
    expect(accepts('ChoicePicker', { options: [{ label: 'A', value: { path: '/v' } }], value: [] })).toBe(false);
    expect(accepts('ChoicePicker', { options: [{ label: 'A' }], value: [] })).toBe(false);
    expect(accepts('ChoicePicker', { options: [{ label: 'A', value: 'a', selected: true }], value: [] })).toBe(false);
  });

  it('types value as DynamicStringList', () => {
    expect(accepts('ChoicePicker', { options: [], value: { path: '/form/interests' } })).toBe(true);
    expect(accepts('ChoicePicker', { options: [], value: 'email' })).toBe(false);
  });

  it('closes the variant and displayStyle enums', () => {
    expect(accepts('ChoicePicker', { options: [], value: [], variant: 'multipleSelection' })).toBe(true);
    expect(accepts('ChoicePicker', { options: [], value: [], variant: 'multiple' })).toBe(false);
    expect(accepts('ChoicePicker', { options: [], value: [], displayStyle: 'chips' })).toBe(true);
    expect(accepts('ChoicePicker', { options: [], value: [], displayStyle: 'dropdown' })).toBe(false);
  });
});

describe('Slider', () => {
  it('requires value and max, but defaults min to 0 (an asymmetry copied from the real schema)', () => {
    expect(accepts('Slider', { value: 5 })).toBe(false);
    expect(accepts('Slider', { max: 10 })).toBe(false);
    expect(parseProps('Slider', { value: 5, max: 10 })).toMatchObject({ min: 0 });
  });

  it('types min/max as plain numbers and only value as dynamic', () => {
    expect(accepts('Slider', { value: { path: '/form/rating' }, max: 10 })).toBe(true);
    expect(accepts('Slider', { value: 5, max: { path: '/form/max' } })).toBe(false);
    expect(accepts('Slider', { value: 5, max: 10, min: { path: '/form/min' } })).toBe(false);
  });

  it('constrains steps to an integer >= 1', () => {
    expect(accepts('Slider', { value: 5, max: 10, steps: 5 })).toBe(true);
    expect(accepts('Slider', { value: 5, max: 10, steps: 1 })).toBe(true);
    expect(accepts('Slider', { value: 5, max: 10, steps: 0 })).toBe(false);
    expect(accepts('Slider', { value: 5, max: 10, steps: -1 })).toBe(false);
    expect(accepts('Slider', { value: 5, max: 10, steps: 2.5 })).toBe(false);
    expect(accepts('Slider', { value: 5, max: 10, steps: 'five' })).toBe(false);
  });
});

describe('DateTimeInput', () => {
  it('requires only value and defaults enableDate/enableTime to false', () => {
    expect(accepts('DateTimeInput', {})).toBe(false);
    expect(parseProps('DateTimeInput', { value: '' })).toMatchObject({ enableDate: false, enableTime: false });
  });

  it('accepts an empty-string value (the real schema says "if not yet set, initialize with an empty string")', () => {
    expect(accepts('DateTimeInput', { value: '' })).toBe(true);
  });

  // See catalog.ts's IsoDateTimeBoundSchema doc for why literal min/max bounds are asserted as
  // ISO 8601 rather than RFC 3339 (which would refuse an offset-less "09:00").
  it('accepts ISO 8601 date, time, and date-time literals for min/max', () => {
    for (const bound of ['2026-01-01', '09:00', '09:00:00', '09:00:00Z', '09:00:00+02:00', '2026-01-01T09:00', '2026-01-01T09:00:00Z', '2026-01-01T09:00:00.500+02:00']) {
      expect(accepts('DateTimeInput', { value: '', min: bound }), bound).toBe(true);
      expect(accepts('DateTimeInput', { value: '', max: bound }), bound).toBe(true);
    }
  });

  it('rejects a literal min/max that is not ISO 8601 at all', () => {
    for (const bound of ['tomorrow', '01/02/2026', '2026-1-1', 'January 1, 2026', '']) {
      expect(accepts('DateTimeInput', { value: '', min: bound }), bound).toBe(false);
    }
  });

  it('passes DataBinding/FunctionCall min/max through unchecked (their value is unknown until resolution)', () => {
    expect(accepts('DateTimeInput', { value: '', min: { path: '/form/earliest' } })).toBe(true);
    expect(accepts('DateTimeInput', { value: '', max: { call: 'formatDate', args: { value: '/now' } } })).toBe(true);
  });
});

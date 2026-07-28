/**
 * Cross-validates this port's hand-rolled wire schemas and interpreter against the **official**
 * A2UI v1.0 conformance fixtures published in the spec repo's own test suite
 * (`specification/v1_0/test/cases/*.json` and `contact_form_example.jsonl`,
 * https://github.com/a2ui-project/a2ui, `main` branch, fetched and inspected this session — see
 * `specification/v1_0/test/README.md` for the suite's own format: each case file has a `schema`
 * target, a `catalog` when the case is catalog-dependent, and a list of `{description, valid, data}`
 * cases). This is a stronger form of evidence than this package's own hand-authored tests alone:
 * these are cases the spec's own authors wrote to pin down exact edge behavior, not cases this
 * port's author invented to match its own understanding.
 *
 * Every literal object/array below is copied verbatim from the fetched fixture files (not
 * re-derived from memory) — line-level provenance is in each `describe` block's own comment.
 *
 * **What's deliberately NOT asserted 1:1 against the official `valid` flag**: several
 * `call_function_message.json` cases are invalid only because of *catalog-specific* function
 * argument schemas (e.g. the "required" function's own args shape) or *catalog-specific*
 * `callableFrom` enforcement — concerns this port's generic wire-schema layer
 * (`parseAgentToRendererMessage`) deliberately does not implement (see `catalog.ts`'s module doc
 * on scope). Those cases are still included below, with the actual (diverging, and why) result
 * asserted explicitly — not silently skipped.
 */
import { describe, expect, it } from 'vitest';
import { parseAgentToRendererMessage } from '../agent-to-renderer.js';
import { parseRendererToAgentMessage } from '../renderer-to-agent.js';
import { createA2uiInterpreter } from '../interpreter.js';
import { createLabCatalog } from '../catalog.js';

// -------------------------------------------------------------------------------------------
// specification/v1_0/test/cases/renderer_messages.json — targets renderer_to_agent.json, and
// every case here is generic/structural (none depend on any catalog's own function/component
// definitions), so this port's parser is expected to agree with the official `valid` flag on
// every single case.
// -------------------------------------------------------------------------------------------
describe('official fixture: renderer_messages.json (renderer_to_agent.json)', () => {
  const cases: Array<{ description: string; valid: boolean; data: unknown }> = [
    {
      description: 'Valid action message',
      valid: true,
      data: {
        version: 'v1.0',
        action: { name: 'submit', surfaceId: 'main', sourceComponentId: 'btn_submit', timestamp: '2023-10-27T10:00:00Z', context: { foo: 'bar' } },
      },
    },
    {
      description: 'Valid error message (validation failed)',
      valid: true,
      data: { version: 'v1.0', error: { code: 'VALIDATION_FAILED', surfaceId: 'main', path: '/components/0/text', message: 'Invalid type' } },
    },
    {
      description: 'Invalid updateDataModel (renamed)',
      valid: false,
      data: { version: 'v1.0', updateDataModel: { surfaceId: 'main', path: '/user/name', value: 'Alice' } },
    },
    {
      description: 'error: Valid with callId',
      valid: true,
      data: { version: 'v1.0', error: { code: 'FUNCTION_FAILED', functionCallId: 'unique-call-id-132', message: 'Something went wrong' } },
    },
    {
      description: 'error: Invalid with BOTH callId and surfaceId',
      valid: false,
      data: { version: 'v1.0', error: { code: 'FUNCTION_FAILED', functionCallId: 'unique-call-id-133', surfaceId: 'main', message: 'Something went wrong' } },
    },
    {
      description: 'error: Invalid with NEITHER callId nor surfaceId',
      valid: false,
      data: { version: 'v1.0', error: { code: 'FUNCTION_FAILED', message: 'Something went wrong' } },
    },
  ];

  it.each(cases)('$description', ({ valid, data }) => {
    expect(parseRendererToAgentMessage(data).ok).toBe(valid);
  });
});

// -------------------------------------------------------------------------------------------
// specification/v1_0/test/cases/call_function_message.json — targets agent_to_renderer.json,
// against `testing_catalog.json` (a catalog this port never fetched). Split into the
// catalog-independent cases (expected to agree with `valid`) and the catalog-dependent ones
// (expected to diverge, divergence asserted explicitly with the reason).
// -------------------------------------------------------------------------------------------
describe('official fixture: call_function_message.json (agent_to_renderer.json) — catalog-independent cases', () => {
  const cases: Array<{ description: string; valid: boolean; data: unknown }> = [
    {
      description: 'CallFunctionMessage: Valid with wantResponse',
      valid: true,
      data: { version: 'v1.0', callFunction: { call: 'openUrl', args: { url: 'https://example.com' } }, functionCallId: 'unique-call-id-123', wantResponse: true },
    },
    {
      description: 'CallFunctionMessage: Valid with remoteOnly',
      valid: true,
      data: { version: 'v1.0', callFunction: { call: 'pingAgent' }, functionCallId: 'unique-call-id-123a', wantResponse: false },
    },
    {
      description: 'CallFunctionMessage: Valid without wantResponse',
      valid: true,
      data: { version: 'v1.0', callFunction: { call: 'openUrl', args: { url: 'https://example.com' } }, functionCallId: 'unique-call-id-124' },
    },
    {
      description: 'CallFunctionMessage: Invalid (missing callId)',
      valid: false,
      data: { version: 'v1.0', callFunction: { call: 'required', args: { value: 'bar' } } },
    },
    {
      description: 'CallFunctionMessage: Invalid (missing callFunction)',
      valid: false,
      data: { version: 'v1.0', functionCallId: 'unique-call-id-125' },
    },
  ];

  it.each(cases)('$description', ({ valid, data }) => {
    expect(parseAgentToRendererMessage(data).ok).toBe(valid);
  });
});

describe('official fixture: call_function_message.json — catalog-dependent cases (documented, expected divergence)', () => {
  it('"Invalid args (nested object in a single value)" is official-invalid (the "required" function\'s own catalog arg schema forbids it) but this port\'s generic schema accepts it — common_types.json\'s own FunctionCall.args explicitly allows "a literal object argument" generically; only a per-function catalog schema (not implemented here) can narrow that further', () => {
    const data = { version: 'v1.0', callFunction: { call: 'required', args: { value: { nested: 'object' } } }, functionCallId: 'unique-call-id-127' };
    expect(parseAgentToRendererMessage(data).ok).toBe(true); // official fixture: valid: false
  });

  it('"Invalid args (array of nested objects)" — same divergence, same reason', () => {
    const data = { version: 'v1.0', callFunction: { call: 'required', args: { value: [{ nested: 'object' }] } }, functionCallId: 'unique-call-id-128' };
    expect(parseAgentToRendererMessage(data).ok).toBe(true); // official fixture: valid: false
  });

  it('"Invalid returnType (not a scalar)" agrees with the official fixture (valid: false) — but for a different, still-correct reason: `returnType` is not a property FunctionCallSchema (common_types.json#/$defs/FunctionCall) permits at all (.strict() rejects the unknown key), independent of any catalog', () => {
    const data = { version: 'v1.0', callFunction: { call: 'required', args: { value: 'bar' }, returnType: 'object' }, functionCallId: 'unique-call-id-129' };
    expect(parseAgentToRendererMessage(data).ok).toBe(false);
  });

  it('"Invalid call to local-only function (required)" is official-invalid at the catalog callableFrom layer, which this port\'s WIRE schema deliberately does not check (that\'s the interpreter\'s job) — so the raw parse is structurally valid...', () => {
    const data = { version: 'v1.0', callFunction: { call: 'required', args: { value: 'test' } }, functionCallId: 'id-3' };
    expect(parseAgentToRendererMessage(data).ok).toBe(true); // structurally fine at the wire layer
  });

  it('...but the full interpreter stack DOES refuse it end to end, same as the official expectation, via callFunction rejection (not registered in this port\'s lab catalog, which does not implement "required" at all — see catalog.ts\'s module doc)', () => {
    const interpreter = createA2uiInterpreter(createLabCatalog());
    const result = interpreter.applyAgentMessage({ version: 'v1.0', callFunction: { call: 'required', args: { value: 'test' } }, functionCallId: 'id-3', wantResponse: true });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'INVALID_FUNCTION_CALL', functionCallId: 'id-3' } }]);
  });
});

// -------------------------------------------------------------------------------------------
// specification/v1_0/test/cases/text_variants.json — targets agent_to_renderer.json, but Text's
// `variant` enum is itself catalog-defined (the *generic* WireComponentSchema has no opinion on
// component-specific properties at all) — so these 3 cases are run through the full interpreter
// (which does own the catalog's per-type schema), not the raw wire parser.
// -------------------------------------------------------------------------------------------
describe('official fixture: text_variants.json — run through the interpreter (catalog-level, not wire-level)', () => {
  function freshSurface() {
    const interpreter = createA2uiInterpreter(createLabCatalog());
    interpreter.applyAgentMessage({ version: 'v1.0', createSurface: { surfaceId: 'test_surface', catalogId: createLabCatalog().catalogId } });
    return interpreter;
  }

  it("Text with valid variant 'caption' is accepted", () => {
    const interpreter = freshSurface();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 'test_surface', components: [{ id: 'text_caption', component: 'Text', text: 'Caption text', variant: 'caption' }] },
    });
    expect(result.rendererMessages).toEqual([]);
    expect(interpreter.getSurface('test_surface')?.components.has('text_caption')).toBe(true);
  });

  it("Text with h1 variant is refused (real basic-catalog Text only allows caption|body — 'h1' is not a real A2UI variant, contrary to what an LLM familiar with HTML might guess)", () => {
    const interpreter = freshSurface();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 'test_surface', components: [{ id: 'text_h1', component: 'Text', text: 'Header', variant: 'h1' }] },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED' } }]);
    expect(interpreter.getSurface('test_surface')?.components.has('text_h1')).toBe(false);
  });

  it('Text with an arbitrary invalid variant string is refused', () => {
    const interpreter = freshSurface();
    const result = interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 'test_surface', components: [{ id: 'text_invalid', component: 'Text', text: 'Invalid', variant: 'not_a_variant' }] },
    });
    expect(result.rendererMessages).toMatchObject([{ error: { code: 'VALIDATION_FAILED' } }]);
  });
});

// -------------------------------------------------------------------------------------------
// specification/v1_0/test/cases/contact_form_example.jsonl — a complete, real, spec-authored
// message SEQUENCE (createSurface -> updateComponents -> updateDataModel -> deleteSurface) for a
// contact form. It exercises 8 distinct real basic-catalog component types (Card, Column, Row,
// Icon, Text, TextField, ChoicePicker, Divider, CheckBox, Button) in one message.
//
// Before the full-catalog pass this was a *mixed*-coverage case: 6 of those types were
// unimplemented, and the assertion below was that they each got refused individually rather than
// choking the whole message. Now that all 18 basic-catalog components are implemented, the same
// unmodified fixture becomes a much stronger claim — the entire real, spec-authored contact form
// is accepted end to end with ZERO validation errors, against schemas written from the catalog
// definition rather than from this fixture. That is a genuine cross-check: the fixture was authored
// independently of this port, so every optional/required/enum decision in the 18 schemas has to be
// right for it to pass clean.
// -------------------------------------------------------------------------------------------
describe('official fixture: contact_form_example.jsonl (a real, complete message sequence)', () => {
  // Each line copied verbatim from the fetched .jsonl (one JSON object per line).
  // The real fixture's own createSurface.catalogId is the *full* basic catalog's URL
  // (`https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`, no fragment). This test
  // substitutes `createLabCatalog().catalogId` (the same URL plus `#lab-subset`) instead — using
  // the real, unmodified catalogId here would silently claim this port implements the *entire*
  // real basic catalog. All 18 of its components are now implemented, but only 3 of its 14
  // functions are, so `#lab-subset` is still the honest identifier; `interpreter.ts`'s own
  // createSurface handling correctly refuses an unrecognized catalogId (tested elsewhere), so
  // keeping the real fixture's literal catalogId would only prove that rejection path again, not
  // let the rest of this real sequence exercise per-component catalog enforcement end to end.
  // Every other field in every line below is unmodified from the fetched fixture.
  const line1 = { version: 'v1.0', createSurface: { surfaceId: 'contact_form_1', catalogId: createLabCatalog().catalogId } };
  const line2 = {
    version: 'v1.0',
    updateComponents: {
      surfaceId: 'contact_form_1',
      components: [
        { id: 'root', component: 'Card', child: 'form_container' },
        { id: 'form_container', component: 'Column', children: ['header_row', 'name_row', 'email_group', 'phone_group', 'pref_group', 'divider_1', 'newsletter_checkbox', 'submit_button'], justify: 'start', align: 'stretch' },
        { id: 'header_row', component: 'Row', children: ['header_icon', 'header_text'], align: 'center' },
        { id: 'header_icon', component: 'Icon', name: 'mail' },
        { id: 'header_text', component: 'Text', text: '# Contact Us' },
        { id: 'name_row', component: 'Row', children: ['first_name_group', 'last_name_group'], justify: 'spaceBetween' },
        { id: 'first_name_group', component: 'Column', children: ['first_name_label', 'first_name_field'], weight: 1 },
        { id: 'first_name_label', component: 'Text', text: 'First Name', variant: 'caption' },
        { id: 'first_name_field', component: 'TextField', label: 'First Name', value: { path: '/contact/firstName' }, variant: 'shortText' },
        { id: 'last_name_group', component: 'Column', children: ['last_name_label', 'last_name_field'], weight: 1 },
        { id: 'last_name_label', component: 'Text', text: 'Last Name', variant: 'caption' },
        { id: 'last_name_field', component: 'TextField', label: 'Last Name', value: { path: '/contact/lastName' }, variant: 'shortText' },
        { id: 'email_group', component: 'Column', children: ['email_label', 'email_field'] },
        { id: 'email_label', component: 'Text', text: 'Email Address', variant: 'caption' },
        {
          id: 'email_field',
          component: 'TextField',
          label: 'Email',
          value: { path: '/contact/email' },
          variant: 'shortText',
          checks: [
            { condition: { call: 'required', args: { value: { path: '/contact/email' } } }, message: 'Email is required.' },
            { condition: { call: 'email', args: { value: { path: '/contact/email' } } }, message: 'Please enter a valid email address.' },
          ],
        },
        { id: 'phone_group', component: 'Column', children: ['phone_label', 'phone_field'] },
        { id: 'phone_label', component: 'Text', text: 'Phone Number', variant: 'caption' },
        {
          id: 'phone_field',
          component: 'TextField',
          label: 'Phone',
          value: { path: '/contact/phone' },
          variant: 'shortText',
          checks: [{ condition: { call: 'regex', args: { value: { path: '/contact/phone' }, pattern: '^\\d{10}$' } }, message: 'Phone number must be 10 digits.' }],
        },
        { id: 'pref_group', component: 'Column', children: ['pref_label', 'pref_picker'] },
        { id: 'pref_label', component: 'Text', text: 'Preferred Contact Method', variant: 'caption' },
        {
          id: 'pref_picker',
          component: 'ChoicePicker',
          variant: 'mutuallyExclusive',
          options: [
            { label: 'Email', value: 'email' },
            { label: 'Phone', value: 'phone' },
            { label: 'SMS', value: 'sms' },
          ],
          value: { path: '/contact/preference' },
        },
        { id: 'divider_1', component: 'Divider', axis: 'horizontal' },
        { id: 'newsletter_checkbox', component: 'CheckBox', label: 'Subscribe to our newsletter', value: { path: '/contact/subscribe' } },
        { id: 'submit_button_label', component: 'Text', text: 'Send Message' },
        {
          id: 'submit_button',
          component: 'Button',
          child: 'submit_button_label',
          variant: 'primary',
          action: {
            event: {
              name: 'submitContactForm',
              context: {
                formId: 'contact_form_1',
                clientTime: { call: 'formatDate', args: { value: '2026-02-02T15:17:00Z', format: 'E MMM d, YYYY h:mm a' } },
                isNewsletterSubscribed: { path: '/contact/subscribe' },
              },
            },
          },
        },
      ],
    },
  };
  const line3 = {
    version: 'v1.0',
    updateDataModel: {
      surfaceId: 'contact_form_1',
      path: '/contact',
      value: { firstName: 'John', lastName: 'Doe', email: 'john.doe@example.com', phone: '1234567890', preference: ['email'], subscribe: true },
    },
  };
  const line4 = { version: 'v1.0', deleteSurface: { surfaceId: 'contact_form_1' } };

  it('every line in the real sequence parses at the wire level, regardless of which components/functions this port implements', () => {
    for (const line of [line1, line2, line3, line4]) {
      expect(parseAgentToRendererMessage(line)).toMatchObject({ ok: true });
    }
  });

  it('the interpreter processes the real sequence end to end with ZERO validation errors — every one of the 25 components in this real, spec-authored message is accepted, including a Card root', () => {
    const interpreter = createA2uiInterpreter(createLabCatalog());
    interpreter.applyAgentMessage(line1);
    const result = interpreter.applyAgentMessage(line2);

    // The whole point: no component in this real fixture is refused for any reason.
    expect(result.rendererMessages).toEqual([]);

    const surface = interpreter.getSurface('contact_form_1')!;
    expect(surface.components.size).toBe(line2.updateComponents.components.length);
    for (const wireComponent of line2.updateComponents.components) {
      expect(surface.components.has(wireComponent.id), wireComponent.id).toBe(true);
    }

    // 'root' is a Card in the real fixture — this port now has a renderable root for this sequence.
    expect(interpreter.getRoot('contact_form_1')).toMatchObject({ id: 'root', component: 'Card', props: { child: 'form_container' } });

    // Spot-check that catalog defaults were actually applied to the newly-implemented types, not
    // just that the components were waved through.
    expect(surface.components.get('divider_1')?.props).toMatchObject({ axis: 'horizontal' }); // Divider
    expect(surface.components.get('pref_picker')?.props).toMatchObject({ variant: 'mutuallyExclusive', displayStyle: 'checkbox', filterable: false }); // ChoicePicker
    expect(surface.components.get('first_name_field')?.props).toMatchObject({ variant: 'shortText' }); // TextField
    expect(surface.components.get('header_icon')?.props).toMatchObject({ name: 'mail' }); // Icon

    interpreter.applyAgentMessage(line3);
    expect(interpreter.getSurface('contact_form_1')?.dataModel).toMatchObject({ contact: { firstName: 'John', email: 'john.doe@example.com' } });

    const deleteResult = interpreter.applyAgentMessage(line4);
    expect(deleteResult.rendererMessages).toEqual([]);
    expect(interpreter.listSurfaceIds()).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// The three official case files below target component types that were unimplemented until the
// full-catalog pass, so none of them could be run before. Like text_variants.json above, they
// nominally target `agent_to_renderer.json`, but every property they exercise is *catalog*-owned
// (the generic wire schema has no opinion on any component's own properties) — so they are run
// through the full interpreter, which is the layer that actually owns the per-type schema.
//
// Every literal below is copied verbatim from the fetched fixture file.
// -------------------------------------------------------------------------------------------

/** Creates a surface on a fresh interpreter, then returns `updateComponents` applied to it. */
function runComponentsCase(components: unknown): { accepted: boolean; errors: unknown[] } {
  const catalog = createLabCatalog();
  const interpreter = createA2uiInterpreter(catalog);
  interpreter.applyAgentMessage({ version: 'v1.0', createSurface: { surfaceId: 'test_surface', catalogId: catalog.catalogId } });
  const result = interpreter.applyAgentMessage({ version: 'v1.0', updateComponents: { surfaceId: 'test_surface', components } });
  return { accepted: result.rendererMessages.length === 0, errors: [...result.rendererMessages] };
}

// specification/v1_0/test/cases/icon_checks.json — all 6 cases, agreeing with the official flag 1:1.
describe('official fixture: icon_checks.json', () => {
  const cases: Array<{ description: string; valid: boolean; components: unknown }> = [
    { description: 'Icon: Valid standard icon string', valid: true, components: [{ id: 'icon_std', component: 'Icon', name: 'star' }] },
    { description: 'Icon: Valid custom SVG icon with literal svgPath string', valid: true, components: [{ id: 'icon_custom_literal', component: 'Icon', name: { svgPath: 'M10 10 H 90 V 90 H 10 Z' } }] },
    { description: 'Icon: Valid custom SVG icon with data bound svgPath path', valid: true, components: [{ id: 'icon_custom_bound', component: 'Icon', name: { svgPath: { path: '/custom/svg/path' } } }] },
    { description: 'Icon: Valid data bound Icon.name', valid: true, components: [{ id: 'icon_name_bound', component: 'Icon', name: { path: '/dynamic/icon/name' } }] },
    { description: 'Icon: Invalid custom SVG icon with type mismatch on svgPath (should fail)', valid: false, components: [{ id: 'icon_invalid_type', component: 'Icon', name: { svgPath: 12345 } }] },
    { description: 'Icon: Invalid custom SVG icon with extra fields in svgPath binding (should fail)', valid: false, components: [{ id: 'icon_invalid_extra', component: 'Icon', name: { svgPath: { path: '/custom/svg/path', extra: 1 } } }] },
  ];

  it.each(cases)('$description', ({ valid, components }) => {
    expect(runComponentsCase(components).accepted).toBe(valid);
  });
});

// specification/v1_0/test/cases/tabs_checks.json — both cases, agreeing with the official flag 1:1.
describe('official fixture: tabs_checks.json', () => {
  it('Tabs with empty tabs array (should fail)', () => {
    expect(runComponentsCase([{ id: 'tabs_empty', component: 'Tabs', tabs: [] }]).accepted).toBe(false);
  });

  it('Tabs with valid tabs array', () => {
    const result = runComponentsCase([
      { id: 'tabs_valid', component: 'Tabs', tabs: [{ title: 'Tab 1', child: 'txt1' }] },
      { id: 'txt1', component: 'Text', text: 'Tab 1 content' },
    ]);
    expect(result.accepted).toBe(true);
  });
});

// specification/v1_0/test/cases/checkable_components.json — all 15 cases. These are the single
// best independent check on the 6 Checkable components' schemas: they were authored by the spec's
// own maintainers to pin down `checks` behavior across TextField/ChoicePicker/Slider/CheckBox/
// DateTimeInput, and this port agrees with the official `valid` flag on all 15.
describe('official fixture: checkable_components.json', () => {
  const cases: Array<{ description: string; valid: boolean; components: unknown }> = [
    {
      description: 'TextField with valid checks',
      valid: true,
      components: [{ id: 'tf1', component: 'TextField', label: 'Email', value: { path: '/formData/email' }, checks: [{ condition: { call: 'required', args: { value: { path: '/formData/email' } } }, message: 'Email is required' }, { condition: { call: 'email', args: { value: { path: '/formData/email' } } }, message: 'Must be valid email' }] }],
    },
    {
      description: 'ChoicePicker with valid checks',
      valid: true,
      components: [{ id: 'cp1', component: 'ChoicePicker', label: 'Interests', variant: 'multipleSelection', options: [{ label: 'Code', value: 'code' }, { label: 'Design', value: 'design' }], value: { path: '/formData/interests' }, checks: [{ condition: { call: 'length', args: { value: { path: '/formData/interests' }, min: 1 } }, message: 'Select at least one' }] }],
    },
    {
      description: 'Slider with valid checks',
      valid: true,
      components: [{ id: 'sl1', component: 'Slider', label: 'Rating', min: 1, max: 5, value: { path: '/formData/rating' }, checks: [{ condition: { call: 'numeric', args: { value: { path: '/formData/rating' }, min: 3 } }, message: 'Rating must be > 3' }] }],
    },
    {
      description: 'CheckBox with valid checks',
      valid: true,
      components: [{ id: 'cb1', component: 'CheckBox', label: 'I agree', value: { path: '/formData/agreed' }, checks: [{ condition: { call: 'required', args: { value: { path: '/formData/agreed' } } }, message: 'Must agree' }] }],
    },
    {
      description: 'DateTimeInput with valid checks',
      valid: true,
      components: [{ id: 'dt1', component: 'DateTimeInput', label: 'Date', value: { path: '/formData/date' }, checks: [{ condition: { call: 'required', args: { value: { path: '/formData/date' } } }, message: 'Date required' }] }],
    },
    {
      description: 'TextField with regex validation',
      valid: true,
      components: [{ id: 'tf_regex', component: 'TextField', label: 'Phone', value: { path: '/formData/phone' }, checks: [{ condition: { call: 'regex', args: { value: { path: '/formData/phone' }, pattern: '^\\d{10}$' } }, message: 'Must be 10 digits' }] }],
    },
    {
      description: 'TextField with min/max length validation',
      valid: true,
      components: [{ id: 'tf_len', component: 'TextField', label: 'Password', value: { path: '/formData/pw' }, checks: [{ condition: { call: 'length', args: { value: { path: '/formData/pw' }, min: 8, max: 64 } }, message: 'Password must be 8-64 characters' }] }],
    },
    {
      description: 'Slider with min/max numeric validation',
      valid: true,
      components: [{ id: 'sl_num', component: 'Slider', label: 'Score', min: 0, max: 100, value: { path: '/formData/score' }, checks: [{ condition: { call: 'numeric', args: { value: { path: '/formData/score' }, min: 0, max: 100 } }, message: 'Score must be between 0 and 100' }] }],
    },
    {
      description: 'TextField with complex logic checks (AND/OR/NOT)',
      valid: true,
      components: [{ id: 'tf_complex', component: 'TextField', label: 'Secret Code', value: { path: '/formData/code' }, checks: [{ condition: { call: 'and', args: { values: [{ call: 'required', args: { value: { path: '/formData/code' } } }, { call: 'or', args: { values: [{ call: 'regex', args: { value: { path: '/formData/code' }, pattern: '^[A-Z]' } }, { call: 'not', args: { value: { call: 'regex', args: { value: { path: '/formData/code' }, pattern: '^[0-9]' } } } }] } }] } }, message: 'Code must start with letter or not start with number' }] }],
    },
    {
      description: 'TextField with invalid check (missing message)',
      valid: false,
      components: [{ id: 'tf_invalid', component: 'TextField', label: 'Email', value: { path: '/formData/email' }, checks: [{ condition: { call: 'email', args: { value: { path: '/formData/email' } } } }] }],
    },
    {
      // Agrees with the official flag, but for a narrower reason worth recording: the official
      // catalog rejects this because `formatString`'s declared returnType is `string`, not the
      // boolean a CheckRule condition requires — per-function returnType checking this port does
      // not implement. This port rejects it one layer earlier: `returnType` is not a property
      // `FunctionCall` permits at all (common_types.json#/$defs/FunctionCall declares only
      // `call`/`args`, and every catalog function definition closes with
      // `unevaluatedProperties: false`), so `.strict()` refuses the unknown key regardless of catalog.
      description: 'TextField with invalid function returnType in check',
      valid: false,
      components: [{ id: 'tf_wrong_type', component: 'TextField', label: 'Name', value: { path: '/formData/name' }, checks: [{ condition: { call: 'formatString', args: { value: 'Hello ${/formData/name}' }, returnType: 'string' }, message: 'This should fail because returnType is string, not boolean' }] }],
    },
    {
      description: 'ChoicePicker with length validation (exactly 2)',
      valid: true,
      components: [{ id: 'cp_len', component: 'ChoicePicker', label: 'Interests', variant: 'multipleSelection', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }], value: { path: '/formData/interests' }, checks: [{ condition: { call: 'length', args: { value: { path: '/formData/interests' }, min: 2, max: 2 } }, message: 'Select exactly 2 interests' }] }],
    },
    {
      description: 'Slider with valid steps property',
      valid: true,
      components: [{ id: 'sl_steps', component: 'Slider', label: 'Continuous rating', min: 0, max: 10, steps: 5, value: { path: '/formData/rating' } }],
    },
    {
      description: 'Slider with invalid steps property (string)',
      valid: false,
      components: [{ id: 'sl_steps_invalid_str', component: 'Slider', label: 'Rating', min: 0, max: 10, steps: 'five', value: { path: '/formData/rating' } }],
    },
    {
      description: 'Slider with invalid steps property (less than 1)',
      valid: false,
      components: [{ id: 'sl_steps_invalid_num', component: 'Slider', label: 'Rating', min: 0, max: 10, steps: 0, value: { path: '/formData/rating' } }],
    },
  ];

  it.each(cases)('$description', ({ valid, components }) => {
    expect(runComponentsCase(components).accepted).toBe(valid);
  });

  it('the check-carrying components are actually stored with their CheckRules intact, not merely waved through', () => {
    const catalog = createLabCatalog();
    const interpreter = createA2uiInterpreter(catalog);
    interpreter.applyAgentMessage({ version: 'v1.0', createSurface: { surfaceId: 'test_surface', catalogId: catalog.catalogId } });
    interpreter.applyAgentMessage({
      version: 'v1.0',
      updateComponents: { surfaceId: 'test_surface', components: [{ id: 'tf1', component: 'TextField', label: 'Email', value: { path: '/formData/email' }, checks: [{ condition: { call: 'required', args: { value: { path: '/formData/email' } } }, message: 'Email is required' }] }] },
    });
    expect(interpreter.getSurface('test_surface')?.components.get('tf1')?.props).toMatchObject({
      label: 'Email',
      variant: 'shortText',
      checks: [{ message: 'Email is required' }],
    });
  });
});

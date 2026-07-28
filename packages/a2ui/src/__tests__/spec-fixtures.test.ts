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
// contact form. Uses several real basic-catalog components this port does not implement (Card,
// Icon, TextField, ChoicePicker, Divider, CheckBox) alongside ones it does (Column, Row, Text,
// Button) — an authentic, not self-authored, mixed-catalog-coverage adversarial case: every line
// must still PARSE (wire-level), and the interpreter must accept the implemented component types
// while refusing the unimplemented ones individually (per-component granularity — see
// interpreter.ts's module doc decision 1), not choke on the message as a whole.
// -------------------------------------------------------------------------------------------
describe('official fixture: contact_form_example.jsonl (a real, complete message sequence)', () => {
  // Each line copied verbatim from the fetched .jsonl (one JSON object per line).
  // The real fixture's own createSurface.catalogId is the *full* basic catalog's URL
  // (`https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`, no fragment). This test
  // substitutes `createLabCatalog().catalogId` (the same URL plus `#lab-subset`) instead — using
  // the real, unmodified catalogId here would silently claim this port implements the *entire*
  // real basic catalog (all 18 components), which is false; `interpreter.ts`'s own createSurface
  // handling correctly refuses an unrecognized catalogId (tested elsewhere), so keeping the real
  // fixture's literal catalogId would only prove that rejection path again, not let the rest of
  // this real sequence exercise per-component catalog enforcement end to end. Every other field
  // in every line below is unmodified from the fetched fixture.
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

  it('the interpreter processes the real sequence end to end: accepts implemented component types (Column, Row, Text, Button), refuses unimplemented ones (Card, Icon, TextField, ChoicePicker, Divider, CheckBox) individually rather than choking on the whole message, and cleanly deletes the surface at the end', () => {
    const interpreter = createA2uiInterpreter(createLabCatalog());
    interpreter.applyAgentMessage(line1);
    const result = interpreter.applyAgentMessage(line2);

    const surface = interpreter.getSurface('contact_form_1')!;
    // Implemented types from this real sequence made it in.
    expect(surface.components.has('form_container')).toBe(true); // Column
    expect(surface.components.has('header_row')).toBe(true); // Row
    expect(surface.components.has('name_row')).toBe(true); // Row
    expect(surface.components.has('header_text')).toBe(true); // Text
    // NOTE: 'root' itself is a Card in the real fixture, which this port does not implement — so
    // this real sequence, unmodified, never actually gets a renderable root through this port's
    // catalog. That is an honest, expected consequence of implementing 4 of the real catalog's 18
    // components, not a bug in the interpreter (see catalog.ts's module doc for the full gap list).
    expect(surface.components.has('root')).toBe(false);

    // Unimplemented real basic-catalog types are refused individually, each producing its own error.
    const refusedIds = ['root' /* Card */, 'header_icon' /* Icon */, 'first_name_field' /* TextField */, 'pref_picker' /* ChoicePicker */, 'divider_1' /* Divider */, 'newsletter_checkbox' /* CheckBox */];
    for (const id of refusedIds) {
      expect(surface.components.has(id)).toBe(false);
    }
    expect(result.rendererMessages.length).toBeGreaterThanOrEqual(refusedIds.length);
    for (const message of result.rendererMessages) {
      expect(message).toMatchObject({ error: { code: 'VALIDATION_FAILED', surfaceId: 'contact_form_1' } });
    }

    interpreter.applyAgentMessage(line3);
    expect(interpreter.getSurface('contact_form_1')?.dataModel).toMatchObject({ contact: { firstName: 'John', email: 'john.doe@example.com' } });

    const deleteResult = interpreter.applyAgentMessage(line4);
    expect(deleteResult.rendererMessages).toEqual([]);
    expect(interpreter.listSurfaceIds()).toEqual([]);
  });
});

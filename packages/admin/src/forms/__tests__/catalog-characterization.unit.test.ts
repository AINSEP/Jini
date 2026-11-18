import { expect, it } from 'vitest';
import { buildFieldSettingsPatch, fieldSettingsFor, fieldTypeGroups, maxUploadMb, retypeField, settingsFormFromField, uploadChoices } from '../field-settings.js';
import { formHtmlStarter } from '../html-rules.js';
import type { AdminFormField } from '../models.js';
import { catalogFieldKinds } from './fakes/catalog-fixture.js';
import { fakeFormsCatalog } from './fakes/forms-catalog.js';

// Characterization of everything the forms catalog drives: the starter HTML, the settings each field kind offers,
// the type picker's groups, retyping, the settings draft and its save-time checks. The expected output was recorded from the
// code that read the domain's tables directly; the same file must keep matching once the tables arrive through the port.
const catalog = fakeFormsCatalog();
const MAX_UPLOAD_MB = maxUploadMb({ catalog });
const types = Object.keys(catalogFieldKinds);
const fieldOf = (type: string): AdminFormField => ({
  id: `f_${type}`, label: `Label <${type}> & "q"`, type, required: true, placeholder: `Hold 'er`, helpText: 'Help', minLength: 1, maxLength: 9,
  pattern: '[a-z]+', min: '1', max: '9', step: 1, accept: ['image/*'], maxFileSize: 1048576, default: 'a&b', checkboxValue: 'yes',
  options: [{ value: 'a&b', label: 'A <b>' }, { value: 'c', label: `C "d"` }], attributes: { 'data-x': '1' },
});
const draftOf = (type: string) => settingsFormFromField({ catalog, field: fieldOf(type) });

it('records the starter HTML for every field kind, an unknown kind and escaped text', () => {
  const fields = [...types, 'legacy-kind'].map(fieldOf);
  expect(formHtmlStarter({ fields, catalog: fakeFormsCatalog() }, { submitLabel: 'Go <now>' })).toMatchFileSnapshot('./__snapshots__/starter-html.html');
});

it('records the settings, groups, retype results, drafts and upload limits', () => {
  const recorded = {
    settings: Object.fromEntries([...types, 'legacy-kind'].map((type) => [type, fieldSettingsFor({ catalog, type })])),
    groups: fieldTypeGroups({ catalog }),
    groupsWithLegacy: fieldTypeGroups({ catalog, current: 'legacy-kind' }),
    retyped: Object.fromEntries(types.map((type) => [type, retypeField({ catalog, field: fieldOf('text'), type })])),
    retypedFromFile: retypeField({ catalog, field: fieldOf('file'), type: 'select' }),
    drafts: Object.fromEntries(types.map((type) => [type, draftOf(type)])),
    patches: Object.fromEntries(types.map((type) => [type, buildFieldSettingsPatch({ catalog, form: draftOf(type), field: { type, checkboxValue: 'yes' } })])),
    uploadChoices: uploadChoices({ catalog }),
    maxUploadMb: MAX_UPLOAD_MB,
    oversize: buildFieldSettingsPatch({ catalog, form: { ...draftOf('file'), maxFileSizeMb: String(MAX_UPLOAD_MB + 1) }, field: { type: 'file' } }),
    clamp: buildFieldSettingsPatch({ catalog, form: { ...draftOf('file'), maxFileSizeMb: String(MAX_UPLOAD_MB) }, field: { type: 'file' } }),
    unsafePattern: buildFieldSettingsPatch({ catalog, form: { ...draftOf('text'), pattern: '(?<a>x' }, field: { type: 'text' } }),
  };
  expect(JSON.stringify(recorded, null, 1)).toMatchFileSnapshot('./__snapshots__/settings.json');
});

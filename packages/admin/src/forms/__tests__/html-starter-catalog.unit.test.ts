import { describe, expect, it } from 'vitest';
import { formHtmlStarter } from '../html-rules.js';
import type { AdminFormField } from '../models.js';
import { catalogFieldKinds } from './fakes/catalog-fixture.js';
import { fakeFormsCatalog } from './fakes/forms-catalog.js';

const markingCatalog = () => fakeFormsCatalog({ escapeHtml: ({ value }) => `«${value}»` });
const types = Object.keys(catalogFieldKinds);

// Every authored value the starter interpolates carries a distinct token, so a value that reaches the markup
// without going through the catalog's escaper shows up as a raw token outside the «…» marks.
const TOKENS = ['FLDID', 'LBL', 'PHOLD', 'PATT', 'MINV', 'MAXV', 'OPTVAL', 'OPTLBL', 'DEFV', 'CHKV', 'SUBMIT', 'ACPT', 'ATTRV'];
const fieldOf = (type: string): AdminFormField => ({
  id: 'FLDID', label: 'LBL', type, required: true, placeholder: 'PHOLD', pattern: 'PATT', min: 'MINV', max: 'MAXV', accept: ['ACPT'],
  options: [{ value: 'OPTVAL', label: 'OPTLBL' }], default: 'DEFV', checkboxValue: 'CHKV',
});

describe('formHtmlStarter through the catalog port', () => {
  it.each(types)('sends every interpolated value of a %s field through the catalog\'s escaper', (type) => {
    const html = formHtmlStarter({ fields: [fieldOf(type)], catalog: markingCatalog() }, { submitLabel: 'SUBMIT' });
    const outsideMarks = html.replace(/«[^»]*»/g, '');
    for (const token of TOKENS) expect(outsideMarks, `${token} unescaped in ${type}`).not.toContain(token);
    expect(html).toContain('«FLDID»');
  });

  it('marks the attributes a kind brings along and its submit label', () => {
    const html = formHtmlStarter({ fields: [fieldOf('url')], catalog: markingCatalog() }, { submitLabel: 'SUBMIT' });
    expect(html).toContain('inputmode="«url»"');
    expect(html).toContain('«SUBMIT»');
  });

  it('takes a kind\'s control and input type from the catalog, not from a built-in table', () => {
    const catalog = fakeFormsCatalog({ fieldKinds: { swatch: { control: 'input', htmlType: 'color' } } });
    const html = formHtmlStarter({ fields: [{ id: 'tint', label: 'Tint', type: 'swatch', required: false }], catalog });
    expect(html).toContain('<input type="color" name="tint">');
    // `text` is no longer registered by this catalog, so it falls back like any unknown kind.
    expect(formHtmlStarter({ fields: [{ id: 'a', label: 'A', type: 'text', required: false }], catalog })).toContain('<input type="text" name="a">');
  });

  it('falls back to a plain text input for a kind the catalog does not know, including inherited names', () => {
    const catalog = fakeFormsCatalog({ fieldKinds: {} });
    for (const type of ['legacy', 'constructor', '__proto__', 'toString']) {
      expect(formHtmlStarter({ fields: [{ id: 'x', label: 'X', type, required: false }], catalog })).toContain('<input type="text" name="x">');
    }
  });
});

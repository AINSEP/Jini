import { describe, expect, test } from 'vitest';
import { compileConsentCss, CONSENT_MAX_CSS_LENGTH, parityCss, scopedSelector } from '../render/css.js';
import { parseConsentCss } from '../render/css-parser.js';

const PARITY = '/* ENGINE PARITY BLOCK */';
/** Owner CSS without the engine block, so assertions see only what the owner's rules produced. */
const owned = (css: string) => css.slice(0, css.indexOf(PARITY)).trim();
const codes = (result: { problems: { code: string }[] }) => result.problems.map(p => p.code);

describe('scopedSelector', () => {
  test('anything under the banner scope is allowed; .jini-consent maps to the #jini-consent scope', () => {
    expect(scopedSelector('#jini-consent')).toBe('#jini-consent');
    expect(scopedSelector('  .jini-consent   h2 ')).toBe('#jini-consent h2');
    expect(scopedSelector('#jini-consent>.jini-consent-actions  button:hover')).toBe('#jini-consent > .jini-consent-actions button:hover');
    expect(scopedSelector('.jini-consent-reopen:focus-visible')).toBe('.jini-consent-reopen:focus-visible');
    expect(scopedSelector('#jini-consent *')).toBe('#jini-consent *');
  });

  test('out-of-scope, attribute, structural, pseudo-element and sibling selectors are refused (Reject parity)', () => {
    for (const s of ['body', '#jini-consentx', '.jini-consent-links', 'div #jini-consent', '#jini-consent [data-consent-action="accept"]',
      '#jini-consent button:first-child', '#jini-consent button:not(.x)', '#jini-consent button::before',
      '#jini-consent button + button', '#jini-consent button ~ button', '#jini-consent button:nth-child(2)', '#jini-consent > ']) {
      expect(scopedSelector(s), s).toBeNull();
    }
  });
});

describe('compileConsentCss', () => {
  test('no input still emits the parity block and no problems', () => {
    const { css, problems } = compileConsentCss({});
    expect(problems).toEqual([]);
    expect(css.startsWith(`\n${PARITY}`)).toBe(true);
    expect(css).toBe(parityCss({ colors: null }));
  });

  test('tokens render before owner CSS, and the parity block always comes last', () => {
    const { css, problems } = compileConsentCss({ css: '#jini-consent button{font-weight:700}', tokens: { backgroundColor: '#101820', textColor: '#ffffff', borderRadius: '8px' } });
    expect(problems).toEqual([]);
    const rules = owned(css);
    expect(rules.indexOf('background-color:#101820')).toBeLessThan(rules.indexOf('font-weight:700'));
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css.indexOf(PARITY)).toBeGreaterThan(css.indexOf('font-weight:700'));
    expect(css).toContain('--consent-bg:#101820!important;--consent-fg:#ffffff!important');
  });

  test('a bad rule is dropped and reported on its own; the other rules still apply', () => {
    const result = compileConsentCss({ css: '#jini-consent h2{font-size:18px} #jini-consent button:first-child{font-weight:700} body{color:#000} #jini-consent p{line-height:1.5}' });
    expect(codes(result)).toEqual(['selector', 'selector']);
    expect(result.problems[0]).toMatchObject({ selector: '#jini-consent button:first-child' });
    const rules = owned(result.css);
    expect(rules).toContain('#jini-consent h2{font-size:18px}');
    expect(rules).toContain('#jini-consent p{line-height:1.5}');
    expect(rules).not.toContain('font-weight');
    expect(rules).not.toContain('body');
  });

  test('one bad declaration drops its whole rule (no half-applied rule)', () => {
    const result = compileConsentCss({ css: '#jini-consent h2{font-size:18px;position:absolute} #jini-consent p{font-size:99px}' });
    expect(codes(result)).toEqual(['property', 'value']);
    expect(result.problems[0]).toMatchObject({ property: 'position', selector: '#jini-consent h2' });
    expect(owned(result.css)).toBe('');
  });

  test('every selector of a selector list is checked', () => {
    const result = compileConsentCss({ css: '#jini-consent h2, #jini-consent + p{font-size:14px}' });
    expect(codes(result)).toEqual(['selector']);
    expect(owned(result.css)).toBe('');
    const ok = compileConsentCss({ css: '#jini-consent h2,.jini-consent p{font-size:14px}' });
    expect(owned(ok.css)).toContain('#jini-consent h2,#jini-consent p{font-size:14px}');
  });

  test('root-only properties must sit on #jini-consent itself', () => {
    const result = compileConsentCss({ css: '#jini-consent button{background-color:#000000}' });
    expect(result.problems[0]).toMatchObject({ code: 'property', property: 'background-color' });
  });

  test('colors inside media queries are refused; width-only geometry inside media is kept', () => {
    const result = compileConsentCss({ css: '@media (max-width:640px){#jini-consent{color:#000000}} @media (min-width:641px){#jini-consent{padding:16px}}' });
    expect(codes(result)).toEqual(['property']);
    expect(owned(result.css)).toContain('@media (min-width:641px){#jini-consent{padding:16px}}');
  });

  test('banner padding has an 8px floor on the root only', () => {
    expect(codes(compileConsentCss({ css: '#jini-consent{padding:4px}' }))).toEqual(['value']);
    expect(codes(compileConsentCss({ css: '#jini-consent p{padding:4px}' }))).toEqual([]);
  });

  test('value rules: lengths, shadows, fonts and keywords stay in the safe subset', () => {
    const good = '#jini-consent{box-shadow:0 2px 8px rgba(0,0,0,0.2);max-width:100%;border-width:1px 2px;border-style:dashed;font-family:"Inter", sans-serif;margin:0}'
      + ' #jini-consent button{min-height:44px;letter-spacing:normal;text-transform:uppercase;text-align:center;gap:4px 8px;margin-top:2px;margin-left:0;font-weight:bold}';
    expect(compileConsentCss({ css: good }).problems).toEqual([]);
    expect(compileConsentCss({ css: '#jini-consent{box-shadow:none;max-width:480px} #jini-consent p{letter-spacing:1px;border-color:#abc}' }).problems).toEqual([]);
    for (const bad of ['#jini-consent{box-shadow:0 0 999px #000}', '#jini-consent{box-shadow:0 0 #000}', '#jini-consent{box-shadow:0 0 1px 1px 1px #000}',
      '#jini-consent{box-shadow:0 0 1px}', '#jini-consent{box-shadow:0 0 1px#000}', '#jini-consent{box-shadow:0 0 1px rgba(300,0,0,1)}',
      '#jini-consent{max-width:100px}', '#jini-consent p{font-size:2em}', '#jini-consent p{font-family:url(x)}', '#jini-consent{color:red}',
      '#jini-consent{color:#000000aa}', '#jini-consent p{font-size:14px!important}', '#jini-consent p{border-style:groove}',
      '#jini-consent p{margin:1px 1px 1px 1px 1px}', '#jini-consent p{line-height:3}']) {
      expect(codes(compileConsentCss({ css: bad })), bad).toEqual(['value']);
    }
  });

  test('contrast: low contrast drops only the root colors; other root and owner declarations survive', () => {
    const result = compileConsentCss({ css: '#jini-consent{background-color:#ffffff;color:#eeeeee;border-radius:4px} #jini-consent h2{font-size:18px}' });
    expect(codes(result)).toEqual(['contrast']);
    const rules = owned(result.css);
    expect(rules).toContain('#jini-consent{border-radius:4px}');
    expect(rules).toContain('#jini-consent h2{font-size:18px}');
    expect(rules).not.toContain('#eeeeee');
    expect(result.css).not.toContain('--consent-bg');
  });

  test('contrast: a root rule with only colors disappears entirely when they are dropped', () => {
    const result = compileConsentCss({ css: '#jini-consent{color:#fff}', tokens: {} });
    expect(codes(result)).toEqual(['contrast']);
    expect(owned(result.css)).toBe('');
  });

  test('contrast: the last root color wins and one customized side is checked against the default other side', () => {
    expect(codes(compileConsentCss({ css: '#jini-consent{color:#ffffff} #jini-consent{color:#000000}' }))).toEqual([]);
    expect(codes(compileConsentCss({ tokens: { backgroundColor: '#000000' } }))).toEqual(['contrast']);
    expect(codes(compileConsentCss({ tokens: { textColor: '#111' } }))).toEqual([]);
  });

  test('a syntax error drops the custom CSS only; tokens survive', () => {
    const result = compileConsentCss({ css: '#jini-consent{padding:12px', tokens: { borderRadius: '6px' } });
    expect(result.problems).toEqual([expect.objectContaining({ code: 'syntax', offset: expect.any(Number) })]);
    const rules = owned(result.css);
    expect(rules).toContain('border-radius:6px');
    expect(rules).not.toContain('padding');
  });

  test('size, escapes, HTML delimiters and control characters are refused before parsing', () => {
    expect(codes(compileConsentCss({ css: 'a'.repeat(CONSENT_MAX_CSS_LENGTH + 1) }))).toEqual(['size']);
    for (const css of ['#jini-consent{color:\\30}', '</style><script>', '#jini-consent{\x01}']) {
      expect(codes(compileConsentCss({ css })), css).toEqual(['syntax']);
    }
  });

  test('stored settings of the wrong shape report instead of throwing', () => {
    expect(codes(compileConsentCss({ css: 42 as unknown as string }))).toEqual(['syntax']);
    for (const tokens of [null, [], 'x', { fontFamily: 'x'.repeat(CONSENT_MAX_CSS_LENGTH) }]) {
      const result = compileConsentCss({ tokens: tokens as never });
      expect(codes(result)).toEqual(['syntax']);
    }
    // Unknown token keys go through the same property gate; empty/undefined values are skipped; non-strings become ''.
    expect(codes(compileConsentCss({ tokens: { position: 'fixed', padding: '', fontSize: undefined } as never }))).toEqual(['property']);
    expect(codes(compileConsentCss({ tokens: { fontSize: 14 } as never }))).toEqual(['value']);
  });
});

describe('parityCss', () => {
  test('locks visibility and gives Accept and Reject one fill', () => {
    const css = parityCss({ colors: null });
    expect(css).toContain('#jini-consent .jini-consent-actions button{background:var(--consent-button-bg)!important');
    expect(css).toContain('z-index:2147483647!important');
    expect(css).not.toContain('--consent-bg:');
  });

  test('region and GPC variants are toggled from <html> attributes, unknown region = opt-in variant', () => {
    const css = parityCss({ colors: { background: '#000000', text: '#ffffff' } });
    expect(css).toContain('html[data-consent-region="opt-out"] #jini-consent [data-consent-only="opt-in"]');
    expect(css).toContain('html:not([data-consent-region="opt-out"]) #jini-consent [data-consent-only="opt-out"]');
    expect(css).toContain('html:not([data-consent-gpc]) #jini-consent [data-consent-gpc]');
    expect(css).toContain('background:#000000!important;color:#ffffff!important');
  });
});

describe('parseConsentCss', () => {
  test('comments, strings and width media queries parse; offsets point at the rule', () => {
    const css = '/* c */#jini-consent p{font-family:"a;b"} @media screen and (min-width:1px) and (max-width:2px){#jini-consent{gap:1px;}}';
    expect(parseConsentCss({ css })).toEqual([
      { selector: '#jini-consent p', declarations: [{ property: 'font-family', value: '"a;b"', offset: css.indexOf('font-family') }], offset: 7 },
      { selector: '#jini-consent', declarations: [{ property: 'gap', value: '1px', offset: css.indexOf('gap') }], offset: css.indexOf('#jini-consent{'), media: 'screen and (min-width:1px) and (max-width:2px)' },
    ]);
  });

  test('malformed CSS throws a syntax error with an offset', () => {
    for (const css of ['/* open', '#a{font-family:"open}', '#a{x:f(}', '#a{x:f)}', '#a{x}', '#a{x:1 {}', '{x:1}', '#a{x:1',
      '@media (max-width:1px){@media (max-width:1px){}}', '@import "x";', '@media (max-width:1px){#a{x:1}', '#a{x:[1}']) {
      expect(() => parseConsentCss({ css }), css).toThrow(expect.objectContaining({ offset: expect.any(Number) }));
    }
  });
});

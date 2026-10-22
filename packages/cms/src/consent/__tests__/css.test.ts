import { describe, expect, it } from 'vitest';
import { compileConsentCss, CONSENT_CSS_SCOPE as root, CONSENT_MAX_CSS_LENGTH } from '../index.js';

describe('consent CSS compiler', () => {
  it('emits tokens before scoped user rules and the engine parity block last', () => {
    const result = compileConsentCss({ tokens: { backgroundColor: '#fff', textColor: '#111', padding: '16px', borderRadius: '8px', fontSize: '18px', maxWidth: '600px' }, css: '#jini-consent {padding:24px; border-radius:12px} .jini-consent button {border-radius:10px}' });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root}{background-color:#fff;color:#111;padding:16px;border-radius:8px;font-size:18px;max-width:600px}`);
    expect(result.css).toContain(`${root}{padding:24px;border-radius:12px}`);
    expect(result.css).toContain(`${root} button{border-radius:10px}`);
    expect(result.css.indexOf('padding:16px')).toBeLessThan(result.css.indexOf('padding:24px'));
    expect(result.css.indexOf('border-radius:10px')).toBeLessThan(result.css.indexOf('/* ENGINE PARITY BLOCK */'));
  });
  it('parses comments and selector lists without joining identifiers', () => {
    const result = compileConsentCss({ css: '/* banner */ #jini-consent h2, .jini-consent p { border-color: /* ink */ #123; box-shadow: 0 4px 16px #222; }' });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root} h2,${root} p{border-color:#123;box-shadow:0 4px 16px #222}`);
    expect(compileConsentCss({ css: '#jini-consent {c/**/olor:#000}' }).problems[0]?.code).toBe('property');
    expect(compileConsentCss({ css: '#jini-consent{COLOR:#111}' }).css).toContain(`${root}{color:#111}`);
  });
  const bannedDeclarations = [
    'display:none', 'display:block', 'visibility:hidden', 'visibility:collapse',
    'opacity:0', 'opacity:.99', 'opacity:1', 'transform:translateX(-9999px)', 'translate:-9999px',
    'position:absolute', 'position:fixed', 'top:-9999px', 'left:100vw', 'inset:100vh',
    'margin:-9999px', 'z-index:-1', 'width:0', 'height:0', 'max-height:0', 'overflow:hidden',
    'clip:rect(0,0,0,0)', 'clip-path:inset(100%)', 'pointer-events:none', 'content:""',
    'filter:opacity(0)', 'animation:hide 1s', 'transition:all 1s',
    'background-image:url(https://tracker.example/x)', 'background-color:URL(https://tracker.example/x)',
    'background:image-set(url(/pixel) 1x)', 'background-color:image-set("/pixel" 1x)',
    'background-color:var(--hidden)', 'color:expression(alert(1))', 'color:transparent',
    'background-color:rgba(0,0,0,0)', 'color:#0000', 'color:attr(data-color)',
    'background-color:u/**/rl(/pixel)', 'box-shadow:url("https://tracker.example/a;b")',
    'color:#111 !important', 'color:#111 !/**/important', 'color:#111 ! IMPORTANT',
    'padding:0', 'padding:9999px', 'font-size:0', 'font-size:1px', 'max-width:0',
    'max-width:9999px', 'max-width:calc(100vw - 1px)', 'padding:1rem',
    'box-shadow:0 0 9999px #000', 'box-shadow:0 0 0 9999px #000', 'box-shadow:0 0 0 #000 inset', '--custom:url(/pixel)',
  ];
  it.each(bannedDeclarations)('rejects the banned declaration %s without emitting partial CSS', declaration => {
    const result = compileConsentCss({ css: `#jini-consent {border-radius:17px;${declaration}}` });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems[0]).toMatchObject({ selector: root, offset: expect.any(Number), property: declaration.split(':')[0] });
    expect(result.css).not.toContain('border-radius:17px');
    expect(result.css).toContain('/* ENGINE PARITY BLOCK */');
  });
  it.each([
    'body', '#jini-consent button[value="reject"]', '#jini-consent button:nth-child(1)',
    '#jini-consent button:first-child', '#jini-consent button:last-child', '#jini-consent button:not(.accept)',
    '#jini-consent button + button', '#jini-consent button ~ button', '#jini-consent::before',
    '#jini-consent::after', '#jini-consent *', '#jini-consent > button',
    '#jini-consent[data-has-record="true"]', '#jini-consent .jini-consent-pill',
    '#jini-consent-do-not-sell', '#jini-consent a[href="/privacy"]',
    '#jini-consent, body', '#jini-consent /* comma in string */ button[title=","]',
  ])('rejects selectors outside the exact surface allowlist: %s', selector => {
    const result = compileConsentCss({ css: `${selector}{border-radius:17px}` });
    expect(result.problems[0]?.code).toBe('selector');
    expect(result.css).not.toContain('border-radius:17px');
  });
  it.each([
    '@import "https://tracker.example/a.css";', '@import/*;*/"https://tracker.example/a;b.css";',
    '@font-face{font-family:tracker;src:url(https://tracker.example/a.woff)}',
    '@media(max-width:640px){#jini-consent{display:none}}', '@supports(display:grid){#jini-consent{display:none}}',
    '@keyframes hide{to{opacity:0}}', '@layer hidden{#jini-consent{display:none}}',
    '#jini-consent{& button{display:none}}', '#jini-consent{color:#111',
    '#jini-consent{color:#111;/*unclosed}', '#jini-consent{color:"unclosed}',
    '#jini-consent{color:"line\nbreak"}', '#jini-consent{color:rgb(0,0,0]}', '#jini-consent{color:rgb(0,0,0}',
    '#jini-consent{color:#111} trailing', '#jini-consent{color #111}',
    '#jini-consent{color:#111;} </style><script>alert(1)</script>',
    '{color:#111}', '#jini-consent{color;}', '#jini-consent{color:#111}/*',
    '<!-- #jini-consent{color:#111}', '#jini-consent{d\\69splay:none}',
    '#jini-consent{background-color:u\\72l(/pixel)}', '#jini-consent{color:#111\u0000}',
  ])('rejects resource/escape/nesting/malformed syntax: %s', css => {
    const result = compileConsentCss({ css });
    expect(result.problems).toEqual([expect.objectContaining({ code: 'syntax' })]);
    expect(result.css).toBe(compileConsentCss({}).css);
  });
  it('uses final color declarations for contrast, and rejects an entire partially valid batch', () => {
    const result = compileConsentCss({ tokens: { backgroundColor: '#fff', textColor: '#111' }, css: '#jini-consent{border-radius:17px;color:#fff}' });
    expect(result.problems).toEqual([{ code: 'contrast', message: 'Banner text and background must have at least 4.5:1 contrast.' }]);
    expect(result.css).not.toContain('border-radius:17px');
    const repeated = compileConsentCss({ css: '#jini-consent{color:#fff;color:#111;background-color:#fff}' });
    expect(repeated.problems).toEqual([]); expect(repeated.css).toContain('color:#111!important');
    expect(compileConsentCss({ css: '#jini-consent{color:#111;color:#fff}' }).problems[0]?.code).toBe('contrast');
  });
  it('permits dark palettes with verified contrast and disallows descendant color overrides', () => {
    const dark = compileConsentCss({ tokens: { backgroundColor: '#111', textColor: '#fff' } });
    expect(dark.problems).toEqual([]); expect(dark.css).toContain('background:#111!important;color:#fff!important');
    expect(compileConsentCss({ css: '#jini-consent button{color:#fff}' }).problems[0]?.code).toBe('property');
  });
  it('checks contrast on both sides of the 4.5:1 boundary', () => {
    expect(compileConsentCss({ tokens: { backgroundColor: '#fff', textColor: '#777' } }).problems[0]?.code).toBe('contrast');
    expect(compileConsentCss({ tokens: { backgroundColor: '#fff', textColor: '#767676' } }).problems).toEqual([]);
  });
  it('accepts bounded geometry endpoints and a shadow reset', () => {
    const minimum = compileConsentCss({ tokens: { borderRadius: '0', padding: '8px', fontSize: '16px', maxWidth: '256px' }, css: '#jini-consent{box-shadow:none}' });
    expect(minimum.problems).toEqual([]);
    expect(minimum.css).toContain('border-radius:0;padding:8px;font-size:16px;max-width:256px');
    expect(minimum.css).toContain('box-shadow:none');
    expect(compileConsentCss({ tokens: { borderRadius: '32px', padding: '32px', fontSize: '24px', maxWidth: '960px' } }).problems).toEqual([]);
  });
  it('validates tokens through the same declaration policy and rejects unknown tokens', () => {
    expect(compileConsentCss({ tokens: { padding: '-1px' } }).problems[0]).toMatchObject({ code: 'value', property: 'padding' });
    expect(compileConsentCss({ tokens: { backgroundColor: 'url(/pixel)' } }).problems[0]?.code).toBe('value');
    expect(compileConsentCss({ tokens: JSON.parse('{"position":"absolute"}') }).problems[0]).toMatchObject({ code: 'property', property: 'position' });
    expect(compileConsentCss({ tokens: JSON.parse('{"__proto__":"hidden"}') }).problems[0]?.code).toBe('property');
    expect(compileConsentCss({ tokens: JSON.parse('{"color":"#111"}') }).problems[0]?.code).toBe('value');
    expect(compileConsentCss({ tokens: JSON.parse('{"padding":16}') }).problems[0]?.code).toBe('value');
  });
  it('bounds parser input and reports structured syntax offsets for the admin', () => {
    const atLimit = ' '.repeat(CONSENT_MAX_CSS_LENGTH);
    expect(compileConsentCss({ css: atLimit }).problems).toEqual([]);
    expect(compileConsentCss({ css: atLimit + ' ' }).problems[0]?.code).toBe('size');
    expect(compileConsentCss({ tokens: { padding: atLimit } }).problems[0]?.code).toBe('size');
    expect(compileConsentCss({ css: '#jini-consent{' }).problems[0]).toMatchObject({ code: 'syntax', offset: 13 });
  });
  it('keeps theme-token colors and font size when no color is customized', () => {
    const { css } = compileConsentCss({ tokens: { borderRadius: '8px' } });
    expect(css).not.toMatch(/background:#[0-9a-f]+!important|color:#[0-9a-f]+!important|font-size:16px/);
    expect(css).toContain('color:inherit!important;background:transparent!important;border:1px solid currentColor!important');
    expect(compileConsentCss({ tokens: { backgroundColor: '#ff0' } }).css).toContain('background:#ff0!important;color:#222222!important');
    expect(compileConsentCss({ tokens: { backgroundColor: '#333' } }).problems[0]?.code).toBe('contrast');
  });
  it('refuses escapes before parsing and reports wrongly shaped stored settings instead of throwing', () => {
    expect(compileConsentCss({ css: '#jini-consent{d\\69splay:none}' }).problems[0]?.code).toBe('syntax');
    expect(compileConsentCss({ css: '#jini-consent > button{border-radius:1px}' }).problems[0]?.code).toBe('selector');
    expect(compileConsentCss({ css: 12 as unknown as string }).problems[0]?.code).toBe('syntax');
    expect(compileConsentCss({ tokens: null as unknown as object }).problems[0]?.code).toBe('syntax');
    expect(compileConsentCss({ tokens: ['#fff'] as unknown as object }).problems[0]?.code).toBe('syntax');
  });
  it('reasserts action parity, focus, visibility and full-width bottom placement at 640px', () => {
    const { css } = compileConsentCss({});
    expect(css).toContain('visibility:visible!important;opacity:1!important;transform:none!important');
    expect(css).toContain('z-index:2147483000!important');
    expect(css).toContain('min-height:44px!important');
    expect(css).toContain('flex:1 1 0!important');
    expect(css).toContain(':focus-visible{outline:3px solid currentColor!important;outline-offset:3px!important}');
    expect(css).toContain(`@media(max-width:640px){${root}{inset:auto 0 0!important;width:100%!important;max-width:100%!important`);
  });
});

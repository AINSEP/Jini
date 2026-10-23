import { describe, expect, it } from 'vitest';
import { compileConsentCss, CONSENT_CSS_SCOPE as root, CONSENT_CSS_SELECTORS, CONSENT_MAX_CSS_LENGTH } from '../index.js';

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
    const result = compileConsentCss({ css: '/* banner */ #jini-consent h2, .jini-consent p { border-color: /* ink */ #123; margin: 0 4px; }' });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root} h2,${root} p{border-color:#123;margin:0 4px}`);
    expect(compileConsentCss({ css: '#jini-consent {c/**/olor:#000}' }).problems[0]?.code).toBe('property');
    expect(compileConsentCss({ css: '#jini-consent{COLOR:#111}' }).css).toContain(`${root}{color:#111}`);
  });
  it('accepts compact owner typography and spacing without parity resetting geometry', () => {
    const result = compileConsentCss({ css: `
      #jini-consent{max-width:380px;padding:14px 16px;font-size:13.5px;line-height:1.45;box-shadow:0 12px 32px rgba(0, 0, 0, .14)}
      #jini-consent h2{font-size:15px;margin:0 0 4px}
      #jini-consent p{margin:0 0 6px}
      #jini-consent a, #jini-consent summary{padding:0;font-size:12.5px;min-height:24px}
      #jini-consent .jini-consent-actions{margin-top:10px;gap:8px}
      #jini-consent button{min-height:34px;padding:4px 12px;border-radius:8px}
      #jini-consent #jini-consent-do-not-sell{padding:0;min-height:24px;font-size:12.5px;margin-top:10px}
      #jini-consent details{margin:10px 0 0 14px}
      @media(max-width:640px){#jini-consent{max-width:100%;padding:12px 16px;border-radius:14px 14px 0 0}}
    ` });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root}{max-width:380px;padding:14px 16px;font-size:13.5px;line-height:1.45;box-shadow:0 12px 32px rgba(0, 0, 0, .14)}`);
    expect(result.css).toContain(`${root} a,${root} summary{padding:0;font-size:12.5px;min-height:24px}`);
    expect(result.css).toContain(`${root} #jini-consent-do-not-sell{padding:0;min-height:24px;font-size:12.5px;margin-top:10px}`);
    expect(result.css).toContain(`@media (max-width:640px){${root}{max-width:100%;padding:12px 16px;border-radius:14px 14px 0 0}}`);
    const parity = result.css.slice(result.css.indexOf('/* ENGINE PARITY BLOCK */'));
    expect(parity).not.toMatch(/(?:padding|font-size|line-height|gap|border-radius|min-height):[^;}]+!important/);
  });
  it.each([
    'font-size:12px', 'font-size:24px', 'min-height:24px', 'min-height:64px',
    'gap:0 32px', 'margin:0 8px 16px 32px', 'margin-left:14px', 'margin-top:10px',
    'line-height:1', 'line-height:2', 'border-radius:0 32px 0 32px',
  ])('accepts safe geometry endpoints on the shared buttons: %s', declaration => {
    const result = compileConsentCss({ css: `#jini-consent button{${declaration}}` });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root} button{${declaration}}`);
  });
  it.each([
    'box-shadow:0 0 0 rgba(0,0,0,0)', 'box-shadow:24px 24px 64px 8px rgba(255,255,255,1)',
  ])('accepts bounded shadows only on the banner root: %s', declaration => {
    for (const css of [`#jini-consent{${declaration}}`, `@media(max-width:640px){#jini-consent{${declaration}}}`]) {
      const result = compileConsentCss({ css });
      expect(result.problems).toEqual([]);
      expect(result.css).toContain(`${root}{${declaration}}`);
    }
  });
  it.each(CONSENT_CSS_SELECTORS.filter(selector => selector !== root))('rejects shadows on the inner surface %s at every viewport', selector => {
    for (const css of [`${selector}{box-shadow:0 24px 0 8px #222222}`, `@media(max-width:640px){${selector}{box-shadow:0 24px 0 8px #222222}}`]) {
      const result = compileConsentCss({ css: `#jini-consent{border-radius:17px}${css}` });
      expect(result.problems).toEqual([expect.objectContaining({ code: 'property', property: 'box-shadow', selector })]);
      expect(result.css).toBe(compileConsentCss({}).css);
    }
  });
  it.each(['', ' h2', ' p', ' details', ' .jini-consent-initial', ' .jini-consent-actions'])('rejects min-height on non-control surface suffix "%s", including in media', surface => {
    const selector = `#jini-consent${surface}`;
    for (const css of [`${selector}{min-height:64px}`, `@media(max-width:640px){${selector}{min-height:64px}}`]) {
      const result = compileConsentCss({ css });
      expect(result.problems[0]).toMatchObject({ code: 'property', property: 'min-height' });
      expect(result.css).toBe(compileConsentCss({}).css);
    }
  });
  it.each(['button', 'a', 'summary', '#jini-consent-do-not-sell'])('accepts bounded min-height on the control %s', control => {
    const result = compileConsentCss({ css: `#jini-consent ${control}{min-height:64px}` });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root} ${control}{min-height:64px}`);
  });
  it.each(['margin-right', 'margin-bottom'])('rejects unused margin longhand %s', property => {
    const result = compileConsentCss({ css: `#jini-consent button{${property}:6px}` });
    expect(result.problems[0]).toMatchObject({ code: 'property', property });
    expect(result.css).toBe(compileConsentCss({}).css);
  });
  it('preserves ordered width conditions and scopes every rule inside them', () => {
    const result = compileConsentCss({ css: `
      @media screen and (min-width:641px) and (max-width:1280px){
        #jini-consent{max-width:400px} .jini-consent h2{font-size:16px}
      }
      @media(max-width:640px){#jini-consent{padding:12px}}
      @media(max-width:640px){#jini-consent{padding:14px}}
    ` });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`@media screen and (min-width:641px) and (max-width:1280px){${root}{max-width:400px}}`);
    expect(result.css).toContain(`@media screen and (min-width:641px) and (max-width:1280px){${root} h2{font-size:16px}}`);
    expect(result.css.indexOf('padding:12px')).toBeLessThan(result.css.indexOf('padding:14px'));
  });
  it.each([
    'display:none', 'visibility:hidden', 'opacity:0', 'font-size:11.99px', 'min-height:0',
    'width:0', 'max-width:0', 'height:0', 'position:absolute', 'left:-9999px',
    'margin:-32px', 'transform:scale(0)', 'line-height:0', 'overflow:hidden',
  ])('rejects hiding/shrinking required controls, including inside media queries: %s', declaration => {
    for (const selector of ['#jini-consent', '#jini-consent button', '#jini-consent #jini-consent-do-not-sell', '#jini-consent .jini-consent-actions', '#jini-consent .jini-consent-initial']) {
      for (const css of [`${selector}{${declaration}}`, `@media(max-width:640px){${selector}{${declaration}}}`]) {
        const result = compileConsentCss({ css: `#jini-consent{border-radius:17px}${css}` });
        expect(result.problems.length).toBeGreaterThan(0);
        expect(result.css).toBe(compileConsentCss({}).css);
      }
    }
  });
  it.each([
    'body{margin:0}', '#jini-consent,body{font-size:12px}',
    '#jini-consent button[value="reject"]{font-size:12px}',
    '#jini-consent button[value="accept"]{font-size:24px}',
    '#jini-consent button:nth-child(1){padding:0}',
    '#jini-consent #jini-consent-do-not-sell{color:#fff}',
    '#jini-consent{background-color:#fff}', '#jini-consent{color:#fff}',
  ])('rejects unscoped, unequal or conditionally unverified styling: %s', rule => {
    const result = compileConsentCss({ tokens: { backgroundColor: '#111', textColor: '#fff' }, css: `#jini-consent{border-radius:17px}@media(max-width:640px){${rule}}` });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.css).toBe(compileConsentCss({}).css);
  });
  it.each([
    '0 0 8px rgba(256,0,0,1)', '0 0 8px rgba(0,0,0,1.1)', '0 0 8px rgba(0,0,0,-1)',
    '0 0 8px rgba(0,0,0,NaN)', '0 0 8px rgba(0,0,0)', '0 0 8px rgba(0,0,0,var(--alpha))',
    '0 0 8px rgba(0,0,0,.1),0 0 9999px #000', '0 0 8px 9px rgba(0,0,0,.1)',
    '0 0 8px rgba(0,0,0,.1) inset',
  ])('rejects unsafe or malformed alpha shadows: %s', shadow => {
    const result = compileConsentCss({ css: `#jini-consent{box-shadow:${shadow}}` });
    expect(result.problems[0]).toMatchObject({ code: 'value', property: 'box-shadow' });
    expect(result.css).toBe(compileConsentCss({}).css);
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
    'padding:0', 'padding:9999px', 'font-size:0', 'font-size:1px', 'font-size:11.99px', 'max-width:0',
    'max-width:9999px', 'max-width:calc(100vw - 1px)', 'padding:1rem',
    'min-height:0', 'min-height:23.99px', 'min-height:65px', 'gap:-1px', 'gap:9999px', 'margin:9999px',
    'line-height:0', 'line-height:.1', 'border-radius:9999px',
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
    '@supports(display:grid){#jini-consent{display:none}}',
    '@media(max-width:640px){@media(min-width:320px){#jini-consent{padding:12px}}}',
    '@media(max-width:640px){#jini-consent{padding:12px}',
    '@media(max-width:640px);', '@media(prefers-color-scheme:dark){#jini-consent{padding:12px}}',
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
    expect(result.problems).toEqual([{ code: 'contrast', message: 'Banner text must have at least 4.5:1 contrast against the background and button fills.' }]);
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
  it.each([
    ['#fff', '#777'], ['#ffffff', '#767676'], ['#fff', '#707070'], ['#666', '#fff'],
  ])('rejects palette %s / %s when the banner or either button fill falls below 4.5:1', (backgroundColor, textColor) => {
    for (const input of [
      { tokens: { backgroundColor, textColor } },
      { css: `#jini-consent{background-color:${backgroundColor};color:${textColor}}` },
    ]) {
      const result = compileConsentCss(input);
      expect(result.problems).toEqual([expect.objectContaining({ code: 'contrast' })]);
      expect(result.css).toBe(compileConsentCss({}).css);
    }
  });
  it.each([['#fff', '#666'], ['#555', '#fff']])('accepts text and button fills with sufficient contrast for palette %s / %s', (backgroundColor, textColor) => {
    const result = compileConsentCss({ tokens: { backgroundColor, textColor } });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`--consent-bg:${backgroundColor}!important;--consent-fg:${textColor}!important;`);
  });
  it('accepts bounded geometry endpoints and a shadow reset', () => {
    const minimum = compileConsentCss({ tokens: { borderRadius: '0', padding: '8px', fontSize: '12px', maxWidth: '256px' }, css: '#jini-consent{box-shadow:none}' });
    expect(minimum.problems).toEqual([]);
    expect(minimum.css).toContain('border-radius:0;padding:8px;font-size:12px;max-width:256px');
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
    expect(css).toContain(`${root} .jini-consent-actions button{background:var(--consent-button-bg)!important;border:1px solid var(--consent-button-border)!important}`);
    expect(compileConsentCss({ tokens: { backgroundColor: '#ff0' } }).css).toContain('background:#ff0!important;color:#222222!important');
    expect(compileConsentCss({ tokens: { backgroundColor: '#333' } }).problems[0]?.code).toBe('contrast');
  });
  it('shares the final validated root palette with derived text and button colors', () => {
    const result = compileConsentCss({ tokens: { backgroundColor: '#fff', textColor: '#111' }, css: '#jini-consent{background-color:#111;color:#fff}' });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain('--consent-bg:#111!important;--consent-fg:#fff!important;background:#111!important;color:#fff!important');
    expect(compileConsentCss({ tokens: { backgroundColor: '#ff0' } }).css).toContain('--consent-bg:#ff0!important;--consent-fg:#222222!important;');
    expect(compileConsentCss({ tokens: { textColor: '#111' } }).css).toContain('--consent-bg:#ffffff!important;--consent-fg:#111!important;');
    expect(compileConsentCss({}).css).not.toContain('--consent-bg:');
    expect(compileConsentCss({ tokens: { backgroundColor: '#fff', textColor: '#fff' } }).css).not.toContain('--consent-bg:');
  });
  it('keeps links and summaries unboxed and paragraphs and legends at full contrast', () => {
    const { css } = compileConsentCss({});
    expect(css).toContain(`${root} :is(a,summary){background:transparent!important;border:0!important}`);
    expect(css).toContain(`${root} .jini-consent-actions button:hover{background:var(--consent-button-hover-bg)!important}`);
    expect(css).not.toContain('border:1px solid currentColor!important');
    expect(css).toContain(`${root} :is(h2,p,label,legend,details,form,.jini-consent-initial,.jini-consent-actions){color:inherit!important}`);
    expect(css).not.toMatch(/button\[.*(?:accept|reject)/);
  });
  it('refuses escapes before parsing and reports wrongly shaped stored settings instead of throwing', () => {
    expect(compileConsentCss({ css: '#jini-consent{d\\69splay:none}' }).problems[0]?.code).toBe('syntax');
    expect(compileConsentCss({ css: '#jini-consent > button{border-radius:1px}' }).problems[0]?.code).toBe('selector');
    expect(compileConsentCss({ css: 12 as unknown as string }).problems[0]?.code).toBe('syntax');
    expect(compileConsentCss({ tokens: null as unknown as object }).problems[0]?.code).toBe('syntax');
    expect(compileConsentCss({ tokens: ['#fff'] as unknown as object }).problems[0]?.code).toBe('syntax');
  });
  it('locks action parity and visibility while leaving compact geometry customizable', () => {
    const { css } = compileConsentCss({});
    expect(css).toContain('visibility:visible!important;opacity:1!important;transform:none!important');
    expect(css).toContain('z-index:2147483000!important');
    expect(css).not.toMatch(/(?:min-height|font-size|line-height|gap):[^;}]+!important/);
    expect(css).not.toContain('flex:1');
    expect(css).toContain(`${root} .jini-consent-actions{display:grid!important}`);
    expect(css).toContain(':focus-visible{outline:3px solid currentColor!important;outline-offset:2px!important}');
    expect(css).toContain(`@media(max-width:640px){${root}{inset:auto 0 0!important;width:100%!important;`);
    expect(css).not.toContain('border-radius:0!important');
  });
});

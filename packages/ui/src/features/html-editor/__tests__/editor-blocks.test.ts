// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectEditorBlocks, findEditorBlockOpening, prepareEditorSource } from '../editor-blocks.js';

const tags = (html: string) => {
  const result = detectEditorBlocks({ html }, {});
  if (!result.ok) throw new Error(result.problem);
  return result.blocks.map(block => block.tagName);
};

describe('scriptblocks detector — trimmed 2026-10-11 contract', () => {
  it.each(['data-kui', 'data-kuinetic-future'])('recognizes attribute NAME %s, including empty values', attr => {
    expect(tags(`<div ${attr}=""><span data-kui>inner</span></div>`)).toEqual(['div']);
  });
  it('ignores text, comments, CSS, JS, near prefixes and cut composite rules', () => {
    expect(tags('<!-- <b data-kui></b> --><style>/* data-kui */</style><script>"<b data-kui>"</script><p class="data-kui" data-ku data-reveal data-slide-in>data-kui</p><div role="tablist" class="workflow faq-list"></div>')).toEqual([]);
  });
  it('leaves Kuinetic text effects editable; unknown non-phrasing content and opt-in stay locked', () => {
    expect(tags('<h1 data-kui="text-reveal-down">Tovu <em>CMS</em></h1><p data-kui="fade-up">lede<br>x</p><a data-kui="magnetic" href="/d">Go <span>→</span></a><b data-kui="count-up to:6">6</b><dd data-kui="fade-up">x</dd><img data-kui="zoom-in" src="/a.png">')).toEqual([]);
    expect(tags('<ul data-kui-stagger="45ms"><li data-kui="fade-right">a</li></ul><div data-kui="pin-section"><h2>t</h2></div><p data-kui><canvas></canvas></p><li data-kui><div>x</div></li><h2 data-kui data-editor="block">t</h2>')).toEqual(['div', 'p', 'li', 'h2']);
  });
  it.each([
    'fade', 'fade-in', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'fade-blur-in', 'fade-blur-up',
    'slide-up', 'slide-down', 'slide-left', 'slide-right', 'slide-inline-start', 'slide-inline-end', 'slide-block-start', 'slide-block-end',
    'zoom-in', 'zoom-in-up', 'zoom-in-down', 'pop-in', 'flip-in-x', 'flip-in-y', 'rotate-in', 'rotate-in-left', 'rotate-in-right',
    'roll-in', 'swing-in', 'blur-in', 'bounce-in', 'bounce-in-up', 'bounce-in-down', 'back-in-up', 'back-in-down', 'reveal', 'reveal-once',
    'text-reveal', 'text-reveal-up', 'text-reveal-down', 'text-reveal-mask', 'split-chars', 'split-words', 'split-lines',
    'count-up', 'count-down', 'count-currency', 'count-percent', 'count-compact', 'odometer-roll',
    'wipe-up', 'wipe-down', 'wipe-left', 'wipe-right', 'wipe-circle', 'wipe-diagonal', 'mask-reveal', 'curtain-reveal', 'blur-up',
    'magnetic', 'glow', 'glow-pulse', 'border-glow', 'border-draw', 'beam-border', 'beam-border-auto', 'proximity-glow',
    'shine-sweep', 'lift', 'lift-shadow', 'pop', 'underline-slide', 'underline-center', 'icon-wiggle', 'icon-spin', 'icon-bounce',
  ])('keeps %s containers editable while honoring explicit blocks', effect => {
    expect(tags(`<article data-kui="${effect} 600ms"><h2>Title</h2><p>Text</p></article>`)).toEqual([]);
    expect(tags(`<article data-kui="${effect}" data-editor="block"><p>Text</p></article>`)).toEqual(['article']);
  });
  it.each([
    'ring', 'carousel', 'deck', 'slides', 'pin', 'pin-section', 'pin-until', 'pin-spacer', 'marquee', 'marquee-scroll-linked', 'accordion', 'tabs',
    'carousel-3d', 'carousel-3d-high', 'carousel-3d-low', 'carousel-3d-inside', 'carousel-orbit', 'carousel-stack',
    'carousel-fade', 'carousel-slide', 'slideshow', 'video-hero-slideshow', 'step-progress', 'stacking-cards', 'horizontal-scroll',
    'flip-reorder', 'flip-filter', 'flip-sort', 'flip-shuffle', 'grid-to-list', 'masonry-reflow', 'expand-to-modal', 'accordion-height',
    'card-flip-x', 'card-flip-y', 'flip-card', 'scroll-snap-x', 'scroll-snap-y',
  ])('locks runtime %s even on phrasing-only text and in mixed compositions', effect => {
    expect(tags(`<p data-kui="${effect}">Text <em>here</em></p>`)).toEqual(['p']);
    expect(tags(`<p data-kui="fade-up, ${effect}" data-kui-stagger="45ms">Text</p>`)).toEqual(['p']);
    expect(tags(`<p data-kui="${effect}, border-glow">Text</p>`)).toEqual(['p']);
  });
  it.each(['', '45ms'])('leaves stagger-only containers editable (%s) without swallowing runtime descendants', step => {
    expect(tags(`<ul data-kui-stagger="${step}"><li><p>Text</p></li></ul><div data-kui-stagger="${step}"><p data-kui="marquee">Runtime</p></div>`)).toEqual(['p']);
    expect(tags(`<ul data-kui-stagger="${step}" data-editor="block"><li>Text</li></ul>`)).toEqual(['ul']);
  });
  it('handles composed decorations and quoted selectors without treating parameters as effects', () => {
    expect(tags(`<div data-kui="zoom-in 600ms ease:linear(0, 1) target:'h2, p', shine-sweep, lift"><h2>Title</h2><p>Text</p></div><li data-kui="fade-up, border-glow"><p>Text</p></li>`)).toEqual([]);
  });
  it.each(['future-effect', 'fade-up-future', 'carousel-future', 'fade-up, future-effect'])('retains the structural fallback for unknown %s, even with stagger', effect => {
    expect(tags(`<div data-kui="${effect}" data-kui-stagger="45ms"><p>Text</p></div><p data-kui="${effect}">Text</p>`)).toEqual(['div']);
  });
  it('decorations never suppress independent canvas, autoplay-video or host embed protection', () => {
    const result = detectEditorBlocks({ html: '<div data-kui="fade-up"><canvas data-kui="glow"></canvas><video data-kui="border-glow" autoplay></video><b data-kui="magnetic" data-embed></b></div>' }, {
      isProtectedElement: el => el.hasAttribute('data-embed'),
    });
    expect(result.ok && result.blocks.map(block => [block.tagName, block.reason])).toEqual([
      ['canvas', 'canvas'], ['video', 'autoplay-video'], ['b', 'embed'],
    ]);
  });
  it('keeps siblings and duplicate ids distinct; opt-in absorbs all descendants', () => {
    expect(tags('<div data-kui id="x"></div><div data-kui id="x"></div>')).toEqual(['div', 'div']);
    expect(tags('<section data-editor="block"><canvas></canvas><video autoplay></video></section>')).toEqual(['section']);
  });
  it('live suppresses its subtree; explicit nested block re-enables automatic descendants', () => {
    expect(tags('<section data-editor="live"><canvas></canvas><div data-editor="block"><span data-kui></span></div></section>')).toEqual(['div']);
  });
  it('live island vetoes opaque ancestors, leaving remaining siblings protected', () => {
    expect(tags('<section data-editor="block"><div data-kui></div><p data-editor="live"><span data-kui></span></p><canvas></canvas></section>')).toEqual(['div', 'canvas']);
  });
  it.each(['', '=""', '="false"'])('autoplay%s is boolean presence; ordinary video stays editable', value => {
    expect(tags(`<video autoplay${value}></video><video></video><canvas></canvas>`)).toEqual(['video', 'canvas']);
  });
  it('unknown modes follow ordinary rules; host embed safety survives live opt-out', () => {
    const result = detectEditorBlocks({ html: '<div data-editor="live"><b data-embed></b><i data-kui></i></div><canvas data-editor="unknown"></canvas>' }, {
      describeHostElement: el => el.hasAttribute('data-embed') ? { kindLabel: 'Widget', identityLabel: 'slug x' } : undefined,
    });
    expect(result.ok && result.blocks.map(block => block.tagName)).toEqual(['b', 'canvas']);
  });
  it.each(['<div data-kui>', '<div data-kui>a<p>b</div>', '<table data-kui><tr><td>x</td></tr></table>', '<table><div data-kui>x</div></table>'])('fails closed on recovered or missing ranges: %s', html => {
    const result = prepareEditorSource({ html }, {});
    expect(result.ok).toBe(false);
    expect(result.html).toBe(html);
  });
  it('captures outside style/script once, nested atoms only inside their block, and never feeds scripts to the parser', () => {
    const html = '<style>p { color : red }</style><p>x</p><div data-kui><style>.x{}</style><script>evil()</script></div><script src="/x.js"></script>';
    const result = prepareEditorSource({ html }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instances.map(block => block.tagName)).toEqual(['style', 'div', 'script']);
    expect(result.instances.map(block => block.originalHtml)).toEqual(['<style>p { color : red }</style>', '<div data-kui><style>.x{}</style><script>evil()</script></div>', '<script src="/x.js"></script>']);
    expect(result.html).not.toContain('evil()');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('<style');
    expect(result.canvasCss).toBe('p { color : red }\n.x{}');
  });
});

it('mount tokens never match authored token-looking text, including scripts and adjacent equal originals', () => {
  const html = '<p>data-jini-raw-source-0</p><script>"data-jini-raw-source-1"</script><div data-kui></div><div data-kui></div>';
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  expect(plan.markerAttribute).toBe('data-jini-raw-source-2');
  expect(plan.instances.map(instance => instance.originalHtml)).toEqual(['<script>"data-jini-raw-source-1"</script>', '<div data-kui></div>', '<div data-kui></div>']);
  expect(plan.html).toContain('<p>data-jini-raw-source-0</p>');
  expect(plan.html).not.toContain('"data-jini-raw-source-1"');
});

it('keeps inert data/CSS box selectors but strips resource URLs, handlers and autoplay from a shell', () => {
  const html = '<video data-kui="fx" data-editor="block" style="height:300px" autoplay src="/movie.mp4" onplay="evil()"><source src="/fallback.mp4"></video>';
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  expect(plan.html).toBe('<video data-jini-raw-source-0="0" data-kui="fx" data-editor="block" style="height:300px"></video>');
  expect(plan.instances[0]!.originalHtml).toBe(html);
});

it('authored GrapesJS type/flag directives cannot override a protected shell', () => {
  const html = '<div data-kui data-gjs-type="text" data-gjs-editable="true"></div>';
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  expect(plan.html).toBe('<div data-jini-raw-source-0="0" data-kui=""></div>');
  expect(plan.instances[0]!.originalHtml).toBe(html);
});

it('checks phrasing grandchildren when deciding whether unnamed-effect text stays editable', () => {
  expect(tags('<p data-kui>a <em><span><img></span></em></p><p data-kui>a <em><button>x</button></em></p>')).toEqual(['p']);
});

it('labels a locked block by id, else by its first two classes, else by tag, through the translator', () => {
  const result = detectEditorBlocks({ html: `<canvas class="  a b c "></canvas><canvas id="i"></canvas><canvas></canvas><canvas class="${'x'.repeat(80)}"></canvas>` }, { translate: key => `T:${key}` });
  if (!result.ok) throw new Error(result.problem);
  expect(result.blocks.map(block => block.descriptor)).toEqual([
    { kindLabel: 'T:Canvas', identityLabel: '.a.b', presentation: 'runtime', guidanceLabel: 'T:Locked · Edit in HTML · Preview plays it', inline: false },
    { kindLabel: 'T:Canvas', identityLabel: '#i', presentation: 'runtime', guidanceLabel: 'T:Locked · Edit in HTML · Preview plays it', inline: false },
    { kindLabel: 'T:Canvas', identityLabel: 'canvas', presentation: 'runtime', guidanceLabel: 'T:Locked · Edit in HTML · Preview plays it', inline: false },
    { kindLabel: 'T:Canvas', identityLabel: `.${'x'.repeat(63)}`, presentation: 'runtime', guidanceLabel: 'T:Locked · Edit in HTML · Preview plays it', inline: false },
  ]);
  expect(result.blocks.map(block => block.id)).toEqual([undefined, 'i', undefined, undefined]);
});

it('gives a protected element without a host description an untranslated embed descriptor', () => {
  const result = detectEditorBlocks({ html: '<b data-embed>x</b>' }, { isProtectedElement: el => el.hasAttribute('data-embed') });
  if (!result.ok) throw new Error(result.problem);
  expect(result.blocks[0]!.descriptor).toEqual({ kindLabel: 'Content', identityLabel: 'b', presentation: 'embed', guidanceLabel: 'Locked · Edit in HTML · Preview plays it', inline: true });
});

it('uses the host description verbatim for a host embed', () => {
  const descriptor = { kindLabel: 'Widget', identityLabel: 'slug x' };
  const result = detectEditorBlocks({ html: '<div data-embed></div>' }, { describeHostElement: el => el.hasAttribute('data-embed') ? descriptor : undefined });
  if (!result.ok) throw new Error(result.problem);
  expect(result.blocks[0]!.descriptor).toBe(descriptor);
});

it('refuses a block when another top-level element is not source-supported', () => {
  expect(detectEditorBlocks({ html: '<canvas></canvas><div>x' }, {})).toEqual({ ok: false, problem: "Can't edit this source visually. Use HTML." });
});

it('refuses to prepare an unclosed outside style', () => {
  expect(prepareEditorSource({ html: '<p>x</p><style>x' }, {})).toEqual({ ok: false, html: '<p>x</p><style>x', problem: "Can't edit this source visually. Use HTML." });
});

it('refuses to prepare a script beside an unsupported element', () => {
  expect(prepareEditorSource({ html: '<script></script><div>x' }, {})).toEqual({ ok: false, html: '<script></script><div>x', problem: "Can't edit this source visually. Use HTML." });
});

it('prepares a source without blocks or atoms unchanged', () => {
  expect(prepareEditorSource({ html: '<p>x</p>' })).toEqual({ ok: true, html: '<p>x</p>', markerAttribute: 'data-jini-raw-source-0', instances: [], canvasCss: '' });
});

it('gives a void block a shell without a closing tag', () => {
  const plan = prepareEditorSource({ html: '<p>a</p><img data-kui="pin" src="/a.png" class="c" width="2" onload="x()">' }, {});
  if (!plan.ok) throw new Error(plan.problem);
  expect(plan.html).toBe('<p>a</p><img data-jini-raw-source-0="0" data-kui="pin" class="c" width="2">');
});

it('escapes quotes, ampersands and angle brackets in shell attributes', () => {
  const plan = prepareEditorSource({ html: '<canvas title="t" data-x=\'a"&<b\'></canvas>' }, {});
  if (!plan.ok) throw new Error(plan.problem);
  expect(plan.html).toBe('<canvas data-jini-raw-source-0="0" data-x="a&quot;&amp;&lt;b"></canvas>');
});

it('replaces a style atom with an empty inert span and keeps its CSS for the canvas', () => {
  const plan = prepareEditorSource({ html: '<STYLE>a{}</Style>' }, {});
  if (!plan.ok) throw new Error(plan.problem);
  expect(plan.html).toBe('<span data-jini-raw-source-0="0"></span>');
  expect(plan.instances).toEqual([{ outerStart: 0, outerEnd: 18, openingEnd: 7, originalHtml: '<STYLE>a{}</Style>', openingTag: '<STYLE>', tagName: 'style', nonvisual: true }]);
  expect(plan.canvasCss).toBe('a{}');
});

describe('findEditorBlockOpening', () => {
  const html = '<div id="a"></div><DIV id="b"><div id="a" x></div></DIV><p>';
  it('finds the nth occurrence of a tag and id, matching the tag case-insensitively', () => {
    expect(findEditorBlockOpening({ html, target: { occurrenceIndex: 1, tagName: 'DIV', id: 'a' } })).toEqual({ start: 30, end: 44, openingTag: '<div id="a" x>' });
  });
  it('counts every element of the tag when no id is given', () => {
    expect(findEditorBlockOpening({ html, target: { occurrenceIndex: 1, tagName: 'div' } }, {})).toEqual({ start: 18, end: 30, openingTag: '<DIV id="b">' });
  });
  it('returns undefined past the last occurrence', () => {
    expect(findEditorBlockOpening({ html, target: { occurrenceIndex: 3, tagName: 'div' } })).toBeUndefined();
  });
  it('returns undefined for an occurrence without a trustworthy source range', () => {
    expect(findEditorBlockOpening({ html, target: { occurrenceIndex: 0, tagName: 'p' } })).toBeUndefined();
  });
});

it.each(['<table data-kui="pin"><tbody><tr><td>x</td></tr></tbody></table>', '<svg><canvas></canvas></svg>'])('refuses a well-formed lock in an unsupported context: %s', html => {
  expect(detectEditorBlocks({ html }, {})).toEqual({ ok: false, problem: "Can't edit this source visually. Use HTML." });
});

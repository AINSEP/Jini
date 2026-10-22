// @vitest-environment node
import { expect, it } from 'vitest';
import { detectEditorBlocks, prepareEditorSource } from '../editor-blocks.js';

it('keeps runtime priority, host descriptors, live vetoes and default identities', () => {
  const host = { kindLabel: 'Host', identityLabel: 'own' };
  const result = detectEditorBlocks({ html: '<canvas id="c" data-kui="ring"></canvas><video class="one two three" autoplay></video><div data-editor="block"><p data-editor="live">x</p><b data-host></b></div><canvas></canvas>' }, {
    describeHostElement: el => el.hasAttribute('data-host') ? host : undefined,
    translate: key => `t:${key}`,
  });
  if (!result.ok) throw new Error(result.problem);
  expect(result.blocks.map(block => [block.reason, block.descriptor.identityLabel])).toEqual([
    ['kuinetic', '#c'], ['autoplay-video', '.one.two'], ['embed', 'own'], ['canvas', 'canvas'],
  ]);
  expect(result.blocks[0]!.descriptor.kindLabel).toBe('t:Animation · Kuinetic');
  expect(result.blocks[2]!.descriptor).toBe(host);
});
it('escapes shell layout, uses inert atoms and preserves void protected shells', () => {
  const html = '<img data-host id="a&amp;&quot;&lt;" width="3" src="/x"><style>a{}</style><script>x()</script>';
  const result = prepareEditorSource({ html }, { isProtectedElement: el => el.hasAttribute('data-host') });
  if (!result.ok) throw new Error(result.problem);
  expect(result.html).toBe('<img data-jini-raw-source-0="0" data-host="" id="a&amp;&quot;&lt;" width="3"><span data-jini-raw-source-0="1"></span><span data-jini-raw-source-0="2"></span>');
  expect(result.canvasCss).toBe('a{}');
  expect(result.instances.map(el => el.nonvisual)).toEqual([false, true, true]);
});
it('fails closed on malformed raw atoms and unsupported ancestors without dropping the input', () => {
  for (const html of ['<script>x()', '<div><script>x()</script>', '<table><tr><td><canvas></canvas></td></tr></table>']) {
    expect(prepareEditorSource({ html }, {})).toEqual({ ok: false, html, problem: "Can't edit this source visually. Use HTML." });
  }
});

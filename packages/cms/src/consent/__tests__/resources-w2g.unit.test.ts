import { expect, test } from 'vitest';
import { cssRequestsRemote, external } from '../html/resources.js';

test.each([
  ['a{background:src("/local.woff")}', false],
  ["a{background:src('https://remote.example/font')}", true],
  ['a{background:image-set("/one.png" 1x, "/two.png" 2x)}', false],
  ['a{background:url(/* ) */ /local.png)}', false],
  ['a{background:url("unterminated)}', true],
  ['@import "/local.css" layer(foo);', false],
  ['@import "/local.css" layer(foo)', false],
  ['@import "/local.css" layer(foo', true],
  ['@import "/local.css")', true],
  ['@import /* unterminated', true],
  ['@import;', true],
  ['@import url(/local.css);', false],
  ['a{background:url(data:image/png;base64,AA==)}', false],
  ['a{background:url(\\0 /asset.png)}', true],
  ['a{background:url(\\d800 /asset.png)}', true],
  ['a{background:url(\\110000 /asset.png)}', true],
  ['a{background:u\\\nrl(/local.png)}', false],
] as const)('CSS fetch policy for %s is remote=%s', (css, expected) => {
  expect(cssRequestsRemote({ css })).toBe(expected);
});

test.each([
  ['\\\\collector.example/pixel', true], [' ht\ntps://collector.example/pixel ', true],
  ['/image.png', false], ['../image.png', false], ['?size=2', false], ['#icon', false],
] as const)('normalizes browser URL spelling %s before origin classification', (url, expected) => {
  expect(external({ url })).toBe(expected);
});

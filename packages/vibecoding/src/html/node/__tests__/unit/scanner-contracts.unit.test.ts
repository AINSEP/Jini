import { expect, it } from 'vitest';
import { createParse5RegionParser, scanHtmlRegions } from '../../parse5-region-parser.js';

it('returns a diagnostics array on clean, empty, recovered and malformed fragments', () => {
  const parser = createParse5RegionParser();
  for (const html of ['', '<section data-agent-element="safe">body</section>']) {
    expect(scanHtmlRegions({ html }).parseErrorReasons).toEqual([]);
    expect(parser.checkWellFormed({ html })).toEqual({ ok: true });
  }
  const malformed = '<section data-agent-element="safe">body</section id="stray">';
  const scan = scanHtmlRegions({ html: malformed });
  expect(scan.parseErrorReasons).toEqual([expect.stringMatching(/^end tag with attributes near character \d+$/)]);
  expect(parser.checkWellFormed({ html: malformed })).toEqual({ ok: false, reason: `the document does not parse cleanly: ${scan.parseErrorReasons.join('; ')}` });
  expect(parser.findRegions({ html: malformed }).map(region => region.handle)).toEqual(['safe']);
});

it('keeps real template and ordinary text nodes separate from source handle mentions', () => {
  const html = '<template>text<!-- data-agent-element="example" --><section data-agent-element="safe">body</section></template>';
  const scan = scanHtmlRegions({ html });
  expect(scan.regions.map(region => ({ handle: region.handle, text: html.slice(region.innerStart, region.innerEnd) }))).toEqual([{ handle: 'safe', text: 'body' }]);
  expect(scan.topLevel.map(element => element.tag)).toEqual(['template']);
  expect(scan.documentProblem).toBeUndefined();
});

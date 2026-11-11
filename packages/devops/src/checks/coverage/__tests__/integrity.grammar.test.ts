import { describe, expect, it } from 'vitest';
import { isPureReExportBarrelSource, parseArgs, parseLcovBlocks } from '../integrity.js';

/** L9 §4 integrity.ts: every LCOV line regex is anchored on both ends (junk-prefixed or
 *  junk-suffixed records are ignored), and the barrel recogniser's grammar is pinned. */
describe('parseLcovBlocks anchors', () => {
  it('reads only whole-line records', () => {
    const text = [
      'SF:  /r/a.ts  ', 'FNDA:3,fn', 'FNDA:2,other', 'xFNDA:9,junk', 'DA:1,4', 'DA:2,0', 'xDA:3,9', 'DA:4,5x', 'FNF:2', 'FNF:9x', 'FNH:1', 'end_of_record',
      'SF:/r/b.ts', 'not_end_of_record', 'end_of_recordx', 'end_of_record',
      'XSF:/r/c.ts', 'end_of_record',
    ].join('\r\n');
    expect(parseLcovBlocks({ lcovText: text })).toEqual([
      { file: '/r/a.ts', fnda: [{ hits: 3, name: 'fn' }, { hits: 2, name: 'other' }], da: [4, 0], fnf: 2, fnh: 1 },
      { file: '/r/b.ts', fnda: [], da: [], fnf: undefined, fnh: undefined },
    ]);
  });
  it('FNF/FNH with trailing junk are absent, not parsed', () => {
    expect(parseLcovBlocks({ lcovText: 'SF:/a\nFNF:2x\nFNH:1 \nend_of_record' })[0]).toMatchObject({ fnf: undefined, fnh: undefined });
  });
});

describe('isPureReExportBarrelSource', () => {
  it.each([
    "export * from './a.js';",
    "export * as ns from './a.js'\nexport { b, c as d } from \"./b.js\";",
    "export type { T } from './t.js';",
    "/* header */\n// note\nexport {x} from './x.js';",
    "export   *   from   './a.js'",
  ])('barrel: %j', (sourceText) => {
    expect(isPureReExportBarrelSource({ sourceText })).toBe(true);
  });
  it.each([
    '', '// only a comment', "export * from './a.js';\nexport const x = 1;", "export { a };", "import x from './x.js';",
    "export*from './a.js';", "export * from a;", "export typex { T } from './t.js';", "export { a, { b } } from './a.js';",
  ])('not a barrel: %j', (sourceText) => {
    expect(isPureReExportBarrelSource({ sourceText })).toBe(false);
  });
});

describe('parseArgs', () => {
  it('takes the first non-flag as lcov, consumes the baseline value, ignores unknown flags', () => {
    expect(parseArgs({ argv: ['--x', 'a.info', 'b.info', '--baseline', 'base.json', '--update-baseline'] })).toEqual({ lcovArg: 'a.info', baselinePath: 'base.json', updateBaseline: true });
    expect(parseArgs({ argv: ['--baseline', 'base.json', 'a.info'] })).toEqual({ lcovArg: 'a.info', baselinePath: 'base.json', updateBaseline: false });
    expect(parseArgs({ argv: ['x--', '--baseline'] })).toEqual({ lcovArg: 'x--', baselinePath: undefined, updateBaseline: false });
    expect(parseArgs({ argv: [] })).toEqual({ lcovArg: undefined, baselinePath: undefined, updateBaseline: false });
  });
});

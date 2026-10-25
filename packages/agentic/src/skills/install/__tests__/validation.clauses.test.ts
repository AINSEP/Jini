import { describe, expect, it } from 'vitest';
import { decodeSkillBase64, validateSkillFiles, validateSkillMarkdown, validateSkillPath } from '../validation.js';

/** L9 §4 skills/install/validation: path clauses one at a time (length 240/241, control chars,
 *  colon, dot-segments, dotfiles), canonical base64 grammar and size bound, frontmatter anchoring,
 *  and image magic bytes per type. */
const yamlReader = { read: ({ yaml }: { yaml: string }) => Object.fromEntries(yaml.split('\n').map(l => l.split(': ')).filter(p => p.length === 2)) };
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const MD = '---\nname: ok\ndescription: Does things.\n---\nbody';

describe('validateSkillPath', () => {
  it.each(['SKILL.md', 'references/a.md', 'a'.repeat(240), 'a/b-c_d.e'])('accepts %j', (filePath) => expect(() => validateSkillPath({ filePath })).not.toThrow());
  it.each(['', 'a'.repeat(241), 'a\\b', 'a\tb', 'a\x7fb', 'c:x', '/abs', 'a//b', './a', 'a/./b', '../a', 'a/..', '.hidden', 'a/.git/x', 5 as unknown as string])('refuses %j', (filePath) => {
    expect(() => validateSkillPath({ filePath })).toThrow(`Unsafe skill file path: ${filePath}`);
  });
});

describe('decodeSkillBase64', () => {
  it('decodes canonical padding forms', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd']) expect(decodeSkillBase64({ value: b64(s) }).toString()).toBe(s);
  });
  it.each(['YQ', 'YQ=', 'Y===', 'YW Jj', 'YWJj\n', '****', 'YW=j', 'YWJjZA=', 7 as unknown as string])('refuses non-canonical %j', (value) => {
    expect(() => decodeSkillBase64({ value })).toThrow(/Skill upload (must use valid base64|exceeds its size limit)\./);
  });
  it('size bound: exactly maxBytes passes; one byte over is refused before or after decoding', () => {
    expect(decodeSkillBase64({ value: b64('x'.repeat(6)) }, { maxBytes: 6 })).toHaveLength(6);
    expect(() => decodeSkillBase64({ value: b64('x'.repeat(7)) }, { maxBytes: 6 })).toThrow('Skill upload exceeds its size limit.');
    expect(() => decodeSkillBase64({ value: b64('x'.repeat(4)) }, { maxBytes: 3 })).toThrow('Skill upload exceeds its size limit.');
    expect(() => decodeSkillBase64({ value: b64('x'.repeat(13)) }, { maxBytes: 12 })).toThrow('Skill upload exceeds its size limit.');
  });
});

describe('validateSkillMarkdown', () => {
  it('collapses description whitespace and trims', () => {
    expect(validateSkillMarkdown({ markdown: '---\nname: a-b\ndescription:   two  words  \n---\n', yamlReader })).toEqual({ name: 'a-b', description: 'two words' });
  });
  it.each(['x\n' + MD, ' ' + MD, '---\nname: ok\n---'])('frontmatter must lead the file: %j', (markdown) => {
    expect(() => validateSkillMarkdown({ markdown, yamlReader })).toThrow('SKILL.md must have YAML frontmatter with a name and description.');
  });
  it.each(['a--b', '-a', 'a-', 'A', 'a_b', 'a'.repeat(65)])('name %j refused', (name) => {
    expect(() => validateSkillMarkdown({ markdown: `---\nname: ${name}\ndescription: d\n---\n`, yamlReader })).toThrow(/^Skill name must use/);
  });
  it('description at 1024 passes; 1025 refused', () => {
    expect(() => validateSkillMarkdown({ markdown: `---\nname: a\ndescription: ${'d'.repeat(1024)}\n---\n`, yamlReader })).not.toThrow();
    expect(() => validateSkillMarkdown({ markdown: `---\nname: a\ndescription: ${'d'.repeat(1025)}\n---\n`, yamlReader })).toThrow('Skill description exceeds 1024 characters.');
  });
});

describe('asset signatures', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  const jpg = Buffer.from([255, 216, 255, 0]);
  const files = (name: string, bytes: Buffer) => [{ path: 'SKILL.md', contentBase64: b64(MD) }, { path: `assets/${name}`, contentBase64: b64(bytes) }];
  it.each([['a.png', png], ['a.webp', webp], ['a.jpg', jpg], ['a.jpeg', jpg]] as const)('%s with its own magic passes', (name, bytes) => {
    expect(() => validateSkillFiles({ files: files(name, bytes), yamlReader })).not.toThrow();
  });
  it.each([
    ['a.png', jpg], ['a.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])], ['a.webp', Buffer.concat([Buffer.from('RIFX'), Buffer.alloc(4), Buffer.from('WEBP')])],
    ['a.jpg', Buffer.from([255, 216, 0])], ['a.jpg', Buffer.from([0, 216, 255])], ['a.jpg', png],
  ] as const)('%s with foreign bytes is refused', (name, bytes) => {
    expect(() => validateSkillFiles({ files: files(name, bytes), yamlReader })).toThrow(`Skill asset content does not match its file type: assets/${name}`);
  });
});

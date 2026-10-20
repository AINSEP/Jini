// Characterization pins for validateSkillMarkdown and validateSkillFiles: every refusal message,
// the folder-prefix rules, location/type allow-lists, size limits and content sniffing.
import { describe, expect, it } from 'vitest';
import { decodeSkillBase64, SkillInputError, validateSkillFiles, validateSkillMarkdown, type SkillUploadFile } from '../validation.js';
import type { YamlReaderPort } from '../ports.js';

/** Fixture reader: a tiny `key: value` splitter, not a YAML parser. Hosts supply a real one. */
const yamlReader: YamlReaderPort = {
  read: ({ yaml }) => {
    if (yaml === 'throw') throw new Error('bad yaml');
    if (yaml === 'null') return null;
    if (yaml === 'scalar') return 'text';
    return Object.fromEntries(yaml.split(/\r?\n/).map(line => { const at = line.indexOf(': '); return [line.slice(0, at), line.slice(at + 2)]; }));
  },
};
const md = (front: string, body = 'Body\n') => `---\n${front}\n---\n${body}`;
const SKILL = md('name: ops-guide\ndescription: Run the ops   guide.');
const file = (path: string, content: string | Buffer): SkillUploadFile => ({ path, contentBase64: Buffer.from(content).toString('base64') });
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const JPEG = Buffer.from([255, 216, 255, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
const FRONT = 'SKILL.md must have YAML frontmatter with a name and description.';
const NAME = 'Skill name must use lowercase letters, digits and single hyphens (1–64 characters).';

function refusal(files: readonly SkillUploadFile[]) {
  try { validateSkillFiles({ files, yamlReader }); } catch (error) { return (error as Error).message; }
  return 'accepted';
}

describe('validateSkillMarkdown', () => {
  it('returns the name and whitespace-collapsed description', () => {
    expect(validateSkillMarkdown({ markdown: SKILL, yamlReader })).toEqual({ name: 'ops-guide', description: 'Run the ops guide.' });
  });
  it('accepts CRLF frontmatter and frontmatter at end of file', () => {
    expect(validateSkillMarkdown({ markdown: '---\r\nname: a\r\ndescription: d\r\n---', yamlReader })).toEqual({ name: 'a', description: 'd' });
  });
  it.each(['no frontmatter', '---\nname: a\ndescription: d\n---body', ' ---\nname: a\n---\n'])('refuses missing frontmatter %j', markdown => {
    expect(() => validateSkillMarkdown({ markdown, yamlReader })).toThrow(FRONT);
  });
  it('refuses YAML the reader rejects', () => {
    expect(() => validateSkillMarkdown({ markdown: md('throw'), yamlReader })).toThrow('SKILL.md must have valid YAML frontmatter.');
  });
  it.each(['null', 'scalar', 'description: d', 'name: a', 'name: a\ndescription:  ', 'name: a\ndescription: \t'])('refuses missing name or description in %j', front => {
    expect(() => validateSkillMarkdown({ markdown: md(front), yamlReader })).toThrow(FRONT);
  });
  it.each(['Ops', 'ops--guide', '-ops', 'ops-', 'ops_guide', '', 'a'.repeat(65)])('refuses skill name %j', name => {
    expect(() => validateSkillMarkdown({ markdown: md(`name: ${name}\ndescription: d`), yamlReader })).toThrow(NAME);
  });
  it('accepts a 64-character name and a 1024-character description', () => {
    expect(validateSkillMarkdown({ markdown: md(`name: ${'a'.repeat(64)}\ndescription: ${'d'.repeat(1024)}`), yamlReader }).name).toHaveLength(64);
  });
  it('refuses a description over 1024 characters', () => {
    expect(() => validateSkillMarkdown({ markdown: md(`name: a\ndescription: ${'d'.repeat(1025)}`), yamlReader })).toThrow('Skill description exceeds 1024 characters.');
  });
});

describe('validateSkillFiles acceptance', () => {
  it('accepts every allowed location and type, keyed relative to the skill folder', () => {
    const files = [
      file('pkg/SKILL.md', SKILL), file('pkg/README.md', 'r'), file('pkg/LICENSE', 'MIT'), file('pkg/references/a.txt', 'a'),
      file('pkg/scripts/run.SH', 'echo'), file('pkg/assets/i.png', PNG), file('pkg/assets/i.jpg', JPEG), file('pkg/assets/i.JPEG', JPEG),
      file('pkg/assets/i.webp', WEBP), file('pkg/assets/data.json', '{}'),
    ];
    const result = validateSkillFiles({ files, yamlReader });
    expect([...result.files.keys()]).toEqual(['SKILL.md', 'README.md', 'LICENSE', 'references/a.txt', 'scripts/run.SH', 'assets/i.png', 'assets/i.jpg', 'assets/i.JPEG', 'assets/i.webp', 'assets/data.json']);
    expect(result.files.get('assets/i.png')).toEqual(PNG);
    expect(result).toMatchObject({ name: 'ops-guide', description: 'Run the ops guide.' });
  });
  it('accepts a SKILL.md of exactly 128 KiB and exactly 256 files', () => {
    const big = SKILL + 'a'.repeat(128 * 1024 - Buffer.byteLength(SKILL));
    const files = [file('SKILL.md', big), ...Array.from({ length: 255 }, (_, i) => file(`references/${i}.md`, 'x'))];
    expect(validateSkillFiles({ files, yamlReader }).files.size).toBe(256);
  });
});

describe('validateSkillFiles refusals', () => {
  it.each([[[]], [Array.from({ length: 257 }, (_, i) => file(`references/${i}.md`, 'x'))]])('refuses an empty or oversized file list', files => {
    expect(refusal(files)).toBe('A skill must contain 1–256 files.');
  });
  it('refuses a non-array file list (malformed input fixture)', () => {
    expect(refusal('SKILL.md' as unknown as SkillUploadFile[])).toBe('A skill must contain 1–256 files.');
  });
  it('validates every upload path before looking for SKILL.md', () => {
    expect(refusal([file('../SKILL.md', SKILL)])).toBe('Unsafe skill file path: ../SKILL.md');
  });
  it.each([
    [[file('README.md', 'r')], 'Choose one skill folder containing a single SKILL.md.'],
    [[file('a/SKILL.md', SKILL), file('b/SKILL.md', SKILL)], 'Choose one skill folder containing a single SKILL.md.'],
    [[file('a/SKILL.md', SKILL), file('a/SKILL.md', SKILL)], 'Duplicate skill file path: a/SKILL.md'],
    [[file('a/SKILL.md', SKILL), file('a/SKILL.md', SKILL), file('b/SKILL.md', SKILL)], 'Choose one skill folder containing a single SKILL.md.'],
    [[file('pkg/SKILL.md', SKILL), file('other/README.md', 'r')], 'All files must belong to the selected skill folder.'],
    [[file('SKILL.md', SKILL), file('README.md', 'a'), file('README.md', 'b')], 'Duplicate skill file path: README.md'],
    [[file('SKILL.md', SKILL), file('notes.md', 'n')], 'Unsupported skill file location: notes.md'],
    [[file('SKILL.md', SKILL), file('docs/a.md', 'n')], 'Unsupported skill file location: docs/a.md'],
    [[file('SKILL.md', SKILL), file('references/a.exe', 'n')], 'Unsupported skill file type: references/a.exe'],
    [[file('SKILL.md', SKILL), file('references/a.png', PNG)], 'Unsupported skill file type: references/a.png'],
    [[file('SKILL.md', SKILL), file('README', 'n')], 'Unsupported skill file location: README'],
    [[file('SKILL.md', SKILL), file('assets/LICENSE', 'n')], 'Unsupported skill file type: assets/LICENSE'],
    [[file('SKILL.md', SKILL), { path: 'references/a.md', contentBase64: 'a' }], 'Skill upload must use valid base64.'],
    [[file('SKILL.md', SKILL), file('references/a.md', Buffer.alloc(1024 * 1024 + 1))], 'Skill upload exceeds its size limit.'],
    [[file('SKILL.md', SKILL + 'a'.repeat(128 * 1024))], 'SKILL.md exceeds 128 KiB.'],
    [[file('SKILL.md', SKILL), file('references/a.md', Buffer.from([0xff, 0xfe]))], 'Skill text file must be valid UTF-8 without null bytes: references/a.md'],
    [[file('SKILL.md', SKILL), file('LICENSE', Buffer.from([0xc3]))], 'Skill text file must be valid UTF-8 without null bytes: LICENSE'],
    [[file('SKILL.md', SKILL), file('references/a.md', 'a\0b')], 'Skill text file must be valid UTF-8 without null bytes: references/a.md'],
    [[file('SKILL.md', SKILL), file('assets/a.png', JPEG)], 'Skill asset content does not match its file type: assets/a.png'],
    [[file('SKILL.md', SKILL), file('assets/a.webp', PNG)], 'Skill asset content does not match its file type: assets/a.webp'],
    [[file('SKILL.md', SKILL), file('assets/a.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBX')]))], 'Skill asset content does not match its file type: assets/a.webp'],
    [[file('SKILL.md', SKILL), file('assets/a.jpg', PNG)], 'Skill asset content does not match its file type: assets/a.jpg'],
    [[file('SKILL.md', SKILL), file('assets/a.jpg', Buffer.from([255, 216, 0]))], 'Skill asset content does not match its file type: assets/a.jpg'],
    [[file('SKILL.md', SKILL), file('assets/a.jpg', Buffer.from([255, 0, 255]))], 'Skill asset content does not match its file type: assets/a.jpg'],
    [[file('SKILL.md', md('name: Bad\ndescription: d'))], NAME],
  ])('refusal %#', (files, message) => {
    expect(refusal(files)).toBe(message);
  });
  it('refuses once the combined decoded size passes 8 MiB', () => {
    const files = [file('SKILL.md', SKILL), ...Array.from({ length: 8 }, (_, i) => file(`references/${i}.md`, 'a'.repeat(1024 * 1024)))];
    expect(refusal(files)).toBe('Skill files exceed 8 MiB combined.');
  });
  it('accepts exactly 8 MiB combined', () => {
    const rest = 8 * 1024 * 1024 - Buffer.byteLength(SKILL) - 7 * 1024 * 1024;
    const files = [file('SKILL.md', SKILL), ...Array.from({ length: 7 }, (_, i) => file(`references/${i}.md`, 'a'.repeat(1024 * 1024))), file('references/rest.md', 'a'.repeat(rest))];
    expect(validateSkillFiles({ files, yamlReader }).files.size).toBe(9);
  });
});

describe('validation primitives', () => {
  it('SkillInputError keeps the legacy string call shape', () => {
    const error = new SkillInputError('Legacy message.');
    expect(error.message).toBe('Legacy message.');
    expect(error.cause).toBeUndefined();
  });
  it('decodeSkillBase64 refuses a non-string value (malformed input fixture)', () => {
    expect(() => decodeSkillBase64({ value: 42 as unknown as string })).toThrow('Skill upload exceeds its size limit.');
  });
  it('decodeSkillBase64 refuses an over-long string before decoding', () => {
    expect(() => decodeSkillBase64({ value: 'AAAA'.repeat(2) }, { maxBytes: 3 })).toThrow('Skill upload exceeds its size limit.');
  });
});

describe('refusal causes', () => {
  it('keeps the YAML reader failure as cause', () => {
    const failure = new Error('bad yaml');
    const reader: YamlReaderPort = { read: () => { throw failure; } };
    expect(() => validateSkillMarkdown({ markdown: md('anything'), yamlReader: reader })).toThrow(expect.objectContaining({ message: 'SKILL.md must have valid YAML frontmatter.', cause: failure }));
  });
  it('keeps the UTF-8 decoder failure as cause', () => {
    expect(() => validateSkillFiles({ files: [file('SKILL.md', SKILL), file('LICENSE', Buffer.from([0xc3]))], yamlReader })).toThrow(expect.objectContaining({ cause: expect.any(TypeError) }));
  });
});

import { expect, test, vi } from 'vitest';
import { decodeSkillBase64, SkillInputError, validateSkillFiles, validateSkillMarkdown, validateSkillPath } from '../validation.js';
import { fetchGitHubSkill } from '../github.js';

const markdown = '---\nname: incident-response\ndescription: Respond to outages.\n---\nAlways check ownership.\n';
const yamlReader = { read: vi.fn(() => ({ name: 'incident-response', description: 'Respond to outages.' })) };
const file = (name: string, content: string) => ({ path: name, contentBase64: Buffer.from(content).toString('base64') });

test('validation errors retain object arguments, cause identity and user-facing text', () => {
  const cause = new Error('invalid input');
  const error = new SkillInputError({ message: 'Invalid bundle.' }, { cause });
  expect(error.message).toBe('Invalid bundle.');
  expect(error.cause).toBe(cause);
  expect(error).toBeInstanceOf(Error);
  expect(decodeSkillBase64({ value: 'YWJj' }, { maxBytes: 3 })).toEqual(Buffer.from('abc'));
  expect(() => decodeSkillBase64({ value: 'YWJj' }, { maxBytes: 2 })).toThrow('Skill upload exceeds its size limit.');
  expect(() => validateSkillPath({ filePath: 'references/../escape.md' })).toThrow('Unsafe skill file path: references/../escape.md');
});

// Generalized source install-service cases. The whole bundle is validated before persistence,
// so colliding keys and the combined limit must be rejected even when each file alone is valid.
test('bundle validation preserves guidance and rejects duplicate keys and combined oversize', () => {
  const result = validateSkillFiles({ files: [file('folder/SKILL.md', markdown), file('folder/references/check.md', 'Check this.')], yamlReader });
  expect(result.name).toBe('incident-response');
  expect(result.description).toBe('Respond to outages.');
  expect(result.files.get('SKILL.md')!.toString('utf8')).toBe(markdown);
  expect(() => validateSkillFiles({ files: [file('SKILL.md', markdown), file('SKILL.md', markdown)], yamlReader })).toThrow('Duplicate skill file path: SKILL.md');
  const files = [file('SKILL.md', markdown), ...Array.from({ length: 8 }, (_, i) => file(`references/chunk-${i}.md`, 'a'.repeat(1024 * 1024)))];
  expect(() => validateSkillFiles({ files, yamlReader })).toThrow('Skill files exceed 8 MiB combined.');
});

test('unsafe repository URLs refuse before the injected transport runs', async () => {
  const fetch = vi.fn(async () => { throw new Error('transport must not run'); });
  await expect(fetchGitHubSkill({ githubUrl: 'https://127.0.0.1/repo', fetch })).rejects.toThrow('Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder.');
  expect(fetch).not.toHaveBeenCalled();
});

test('invalid frontmatter uses the reader port and keeps the source refusal message', () => {
  const invalidReader = { read: () => { throw new Error('duplicate keys'); } };
  expect(() => validateSkillMarkdown({ markdown, yamlReader: invalidReader })).toThrow('SKILL.md must have valid YAML frontmatter.');
});

// PARITY: relocated behavior contract retains its original assertions.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { decodeSkillBase64, validateSkillFiles, validateSkillPath } from '../validation.js';
import { createLiveSkillRegistration, type SkillRegistration, type SkillRegistryPort } from '../live-registration.js';

const markdown = '---\nname: incident-response\ndescription: Respond to outages.\n---\nAlways check ownership.\n';
const file = (path: string, content: string) => ({ path, contentBase64: Buffer.from(content).toString('base64') });
// Explicit fixture answers, not a YAML parser. Production hosts supply a safe reader.
const yamlReader = { read: ({ yaml }: { yaml: string }) => {
  if (yaml === 'name: incident-response\ndescription: Respond to outages.') return { name: 'incident-response', description: 'Respond to outages.' };
  if (yaml.includes('name: a\nname: b')) throw new Error('duplicate fixture key');
  if (yaml.includes('name: ../bad')) return { name: '../bad', description: 'Respond to outages.' };
  throw new Error('unexpected fixture');
} };

// Generalized from the originating install-service rejection table; pure validation precedes all writes.
test('bundle validation retains exact guidance and strips only the selected folder prefix', () => {
  const bundle = validateSkillFiles({ files: [file('folder/SKILL.md', markdown), file('folder/references/check.md', 'Check this.')], yamlReader });
  assert.equal(bundle.name, 'incident-response');
  assert.equal(bundle.description, 'Respond to outages.');
  assert.equal(bundle.files.get('SKILL.md')!.toString('utf8'), markdown);
  assert.equal(bundle.files.get('references/check.md')!.toString('utf8'), 'Check this.');
});

test('rejection messages preserve frontmatter, names, traversal, duplicate, UTF-8 and size contracts', () => {
  const cases = [
    [[file('SKILL.md', 'name: incident-response\ndescription: Nope')], 'SKILL.md must have YAML frontmatter with a name and description.'],
    [[file('SKILL.md', '---\nname: a\nname: b\ndescription: Nope\n---\n')], 'SKILL.md must have valid YAML frontmatter.'],
    [[file('SKILL.md', markdown.replace('incident-response', '../bad'))], 'Skill name must use lowercase letters, digits and single hyphens (1–64 characters).'],
    [[file('SKILL.md', markdown), file('references/../escape.md', 'bad')], 'Unsafe skill file path: references/../escape.md'],
    [[file('SKILL.md', markdown), file('assets/payload.exe', 'bad')], 'Unsupported skill file type: assets/payload.exe'],
    [[file('SKILL.md', markdown), file('SKILL.md', markdown)], 'Duplicate skill file path: SKILL.md'],
    [[file('SKILL.md', markdown), file('references/check.md', '\0binary')], 'Skill text file must be valid UTF-8 without null bytes: references/check.md'],
    [[file('SKILL.md', markdown + 'a'.repeat(128 * 1024))], 'SKILL.md exceeds 128 KiB.'],
  ] as const;
  for (const [files, message] of cases) assert.throws(() => validateSkillFiles({ files, yamlReader }), { message });
  for (const filePath of ['../outside', '/absolute', 'references\\escape.md', 'assets/.hidden.png']) assert.throws(() => validateSkillPath({ filePath }), /Unsafe skill file path/);
  assert.deepEqual(decodeSkillBase64({ value: 'AAH/' }, { maxBytes: 3 }), Buffer.from([0,1,255]));
  assert.throws(() => decodeSkillBase64({ value: 'AAH/' }, { maxBytes: 2 }), /exceeds its size limit/);
});

// Generalized from hot-paths.unit.test.ts: the same append-only slot becomes inert on removal.
test('live registration updates handlers and discovery, then fails closed on removal', () => {
  type Descriptor = { id: string; description: string };
  const slots = new Map<string, SkillRegistration<Descriptor, string>>();
  const registry: SkillRegistryPort<Descriptor, string> = {
    list: () => [...slots.values()].map(tool => tool.descriptor), has: ({ id }) => slots.has(id),
    register: ({ tool }) => { assert.equal(slots.has(tool.descriptor.id), false); slots.set(tool.descriptor.id, tool); },
  };
  const replace = createLiveSkillRegistration({ registry, inactiveError: ({ id }) => new Error('inactive:' + id) });
  const tool = (guidance: string): SkillRegistration<Descriptor, string> => ({ descriptor: { id: 'skill_incident_response', description: guidance }, policy: { authorize: () => 'allow' }, handler: ({ context }) => guidance + ':' + context });
  assert.equal(replace({ tools: [tool('first')] }), true);
  const slot = slots.get('skill_incident_response')!;
  assert.equal(slot.handler({ context: 'run' }), 'first:run');
  assert.equal(replace({ tools: [tool('second')] }), true);
  assert.equal(slot.handler({ context: 'run' }), 'second:run');
  replace({ tools: [] });
  assert.deepEqual(registry.list({}), []);
  assert.equal(registry.has({ id: 'skill_incident_response' }), false);
  assert.equal(slot.policy.authorize({ context: 'run' }), 'deny');
  assert.throws(() => slot.handler({ context: 'run' }), /inactive:skill_incident_response/);
  replace({ tools: [tool('third')] });
  assert.equal(slots.size, 1);
  assert.equal(slot.handler({ context: 'run' }), 'third:run');
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSkillToolRegistrations, loadInstalledSkillToolSources, skillToolDerivedRisk, type InstalledSkillToolPorts } from '../installed-skill-tools.js';

const made: string[] = [];
afterEach(async () => { for (const dir of made.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

async function site(files: Record<string, string>) {
  const siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-skill-tools-'));
  made.push(siteDir);
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(siteDir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  return { siteDir, workspaceRoot: path.join(siteDir, 'skills') };
}

function fakePorts(overrides: Partial<InstalledSkillToolPorts> = {}) {
  const reports: string[] = [];
  const ports: InstalledSkillToolPorts = {
    readFrontmatterField: ({ markdown, key }) => new RegExp(`^${key}: (.+)$`, 'm').exec(markdown)?.[1],
    createFileReader: () => ({ read: async () => ({ text: 'reader text', files: ['references/guide.md'] }) }),
    isEnabled: async () => true,
    report: ({ message }) => { reports.push(message); },
    ...overrides,
  };
  return { reports, ports };
}

const SKILL = '---\nname: Code Review\ndescription: Use when reviewing a diff.\n---\nSteps.\n';
const host = { metadata: {}, permission: 'skills.use', catalogModule: 'skills/tools', fileRoot: 'root',
  withExtensionApprovalPolicy: ({ registration }: { registration: import('@jini-ai/core').ToolRegistration }) => registration };

describe('installed skill tools', () => {
  it('loads one source per enabled folder with a sanitized id and bundled files relative to the site', async () => {
    const dirs = await site({ 'skills/review/SKILL.md': SKILL, 'skills/review/references/guide.md': 'g' });
    const { ports } = fakePorts();
    const [source, ...rest] = await loadInstalledSkillToolSources({ ...dirs, ports });
    expect(rest).toEqual([]);
    expect(source).toMatchObject({ id: 'skill_code_review', skillName: 'Code Review', description: 'Use when reviewing a diff.', directory: 'review',
      bundledFiles: [{ kind: 'references', path: 'skills/review/references/guide.md' }] });
  });

  it('skips and reports a folder without frontmatter, and a disabled folder unless includeDisabled', async () => {
    const dirs = await site({ 'skills/bad/SKILL.md': 'no frontmatter', 'skills/off/SKILL.md': SKILL });
    const { ports, reports } = fakePorts({ isEnabled: async ({ directory }) => !directory.endsWith('off') });
    expect(await loadInstalledSkillToolSources({ ...dirs, ports })).toEqual([]);
    expect(reports).toEqual(["[skills] 'bad': SKILL.md has no parseable frontmatter with both 'name' and 'description' — skipped"]);
    expect((await loadInstalledSkillToolSources({ ...dirs, ports }, { includeDisabled: true })).map(s => s.id)).toEqual(['skill_code_review']);
  });

  it('throws when two folders mint the same tool id, and returns [] for a missing workspace root', async () => {
    const dirs = await site({ 'skills/a/SKILL.md': SKILL, 'skills/b/SKILL.md': SKILL });
    await expect(loadInstalledSkillToolSources({ ...dirs, ports: fakePorts().ports })).rejects.toThrow(/more than one installed skill folder/);
    expect(await loadInstalledSkillToolSources({ workspaceRoot: path.join(dirs.siteDir, 'none'), siteDir: dirs.siteDir, ports: fakePorts().ports })).toEqual([]);
  });

  it('registers one tool per source with the host permission, file root and approval policy', async () => {
    const dirs = await site({ 'skills/review/SKILL.md': SKILL, 'skills/review/assets/x.txt': 'x' });
    const sources = await loadInstalledSkillToolSources({ ...dirs, ports: fakePorts().ports });
    const seen: string[] = [];
    const [registration] = buildSkillToolRegistrations({ sources, host: { ...host, withExtensionApprovalPolicy: ({ registration, family }) => { seen.push(family); return registration; } } });
    expect(registration!.descriptor.id).toBe('skill_code_review');
    expect(seen).toEqual(['installed-guidance']);
    expect(skillToolDerivedRisk({ sources }).get('skill_code_review')).toBe('none');
    const result = await registration!.handler({ input: { file: 'references/guide.md' } } as never) as { guidance: string; bundledFiles: unknown[] };
    expect(result.guidance).toBe('reader text');
    expect(result.bundledFiles).toEqual([{ kind: 'assets', root: 'root', path: 'skills/review/assets/x.txt' }]);
    // A wrapper in buildDomainRegistrations may refuse the extra key before the handler does; either refusal is correct.
    await expect(registration!.handler({ input: { other: 1 } } as never)).rejects.toThrow();
  });

  describe('unreadable folders and filesystem failures', () => {
    it('reports a folder without SKILL.md, a SKILL.md that cannot be read, and a name with no tool id; ignores loose files', async () => {
      const dirs = await site({ 'skills/empty/notes.txt': 'x', 'skills/loose.md': 'x', 'skills/symbols/SKILL.md': '---\nname: !!!\ndescription: d\n---\n' });
      await fs.mkdir(path.join(dirs.workspaceRoot, 'dirmd', 'SKILL.md'), { recursive: true });
      const { ports, reports } = fakePorts();
      expect(await loadInstalledSkillToolSources({ ...dirs, ports })).toEqual([]);
      expect(reports).toHaveLength(3);
      expect(reports[0]).toMatch(/^\[skills\] 'dirmd': SKILL\.md could not be read \(EISDIR[^)]*\) — skipped$/);
      expect(reports.slice(1)).toEqual([
        "[skills] 'empty': no SKILL.md — skipped",
        "[skills] 'symbols': frontmatter name '!!!' could not be turned into a valid tool id — skipped",
      ]);
    });

    it('lists bundled files in sorted order, skipping links, and surfaces a non-missing walk failure', async () => {
      const dirs = await site({ 'skills/review/SKILL.md': SKILL, 'skills/review/references/b.md': 'b', 'skills/review/references/nested/a.md': 'a' });
      await fs.symlink(path.join(dirs.workspaceRoot, 'review', 'SKILL.md'), path.join(dirs.workspaceRoot, 'review', 'references', 'link.md'));
      const [source] = await loadInstalledSkillToolSources({ ...dirs, ports: fakePorts().ports });
      expect(source!.bundledFiles).toEqual([
        { kind: 'references', path: 'skills/review/references/b.md' },
        { kind: 'references', path: 'skills/review/references/nested/a.md' },
      ]);
      // `scripts` as a plain file is not "missing": the walk must not hide that.
      await fs.writeFile(path.join(dirs.workspaceRoot, 'review', 'scripts'), 'not a folder');
      await expect(loadInstalledSkillToolSources({ ...dirs, ports: fakePorts().ports })).rejects.toMatchObject({ code: 'ENOTDIR' });
    });

    it('a workspace root that is a file is an error, not an empty skill list', async () => {
      const dirs = await site({ 'skills': 'a file where the folder should be' });
      await expect(loadInstalledSkillToolSources({ ...dirs, ports: fakePorts().ports })).rejects.toMatchObject({ code: 'ENOTDIR' });
    });
  });
});
